import mongoose from "mongoose";
import { responseMessage, ROLES, status_code } from "../../common";
import { userModel, productModel } from "../../database";
import { applyMedicalStoreScope, countData, createData, findOneAndPopulate, getData, getFirstMatch, reqInfo, resolveUserMedicalStoreId, sendError, sendSuccess, titleCase, updateData } from "../../helper";
import { commonValidation, productValidation } from "../../validation";

// ================= Add New Product =================
export const add_product = async (req, res) => {
  reqInfo(req)
  try {
    const { error, value } = productValidation.productDataValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    value.name = titleCase(String(value.name || "").trim())
    if (value.category) value.category = titleCase(String(value.category).trim())

    let ownerId = req.user._id, medicalStoreId: any = req.user?.medicalStoreId
    if (req.user.role === ROLES.admin) {
      if (!value.userId) return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("please select user"))

      const ownerUser: any = await userModel.findOne({ _id: value.userId, isDeleted: false, role: { $ne: ROLES.admin } }, { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 })
      if (!ownerUser) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"))

      ownerId = ownerUser._id
      medicalStoreId = ownerUser.medicalStoreId || (Array.isArray(ownerUser.medicalStoreIds) ? ownerUser.medicalStoreIds[0]?._id || ownerUser.medicalStoreIds[0] : null)
    }

    const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim()
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return sendError(res, status_code.BAD_REQUEST, req.user.role === ROLES.admin ? responseMessage.customMessage("selected user has no medical store assigned") : responseMessage.customMessage("medical store is not assigned to current user"))
    }

    const response = await createData(productModel, {
      ...value,
      userId: ownerId,
      medicalStoreId: storeId,
      isActive: true,
    })
    return sendSuccess(res, response, responseMessage.addDataSuccess("product"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to add product"), error?.message)
  }
};


// ================= Update Product =================
export const update_product_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = productValidation.productUpdateDataValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    if (value.name) value.name = titleCase(String(value.name).trim())
    if (value.category) value.category = titleCase(String(value.category).trim())

    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("product id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const existing: any = await getFirstMatch(productModel, query)
    if (!existing) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("product"))

    // If admin is changing product ownership, validate the selected user and derive the correct medical store.
    if (req.user.role === ROLES.admin && value.userId) {
      const ownerUser: any = await userModel.findOne(
        { _id: value.userId, isDeleted: false, role: { $ne: ROLES.admin } },
        { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 }
      );
      if (!ownerUser) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"));

      const resolvedStoreId =
        (ownerUser.medicalStoreId && String(ownerUser.medicalStoreId)) ||
        (Array.isArray(ownerUser.medicalStoreIds)
          ? String(ownerUser.medicalStoreIds[0]?._id || ownerUser.medicalStoreIds[0] || "")
          : "");

      if (!resolvedStoreId || !mongoose.Types.ObjectId.isValid(resolvedStoreId)) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("selected user has no medical store assigned"));
      }

      value.userId = ownerUser._id;
      value.medicalStoreId = resolvedStoreId;
    }

    if (req.user.role !== ROLES.admin && value.medicalStoreId) {
      const currentUserMedicalStoreId = resolveUserMedicalStoreId(req)
      if (!currentUserMedicalStoreId || currentUserMedicalStoreId !== String(value.medicalStoreId)) {
        return sendError(res, status_code.FORBIDDEN, responseMessage.customMessage("not authorized for selected medical store"))
      }
    }

    if (req.user.role !== ROLES.admin) {
      delete value.medicalStoreId
      delete value.userId
    }

    const response = await updateData(productModel, query, { ...value }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.updateDataError("product"))
    return sendSuccess(res, response, responseMessage.updateDataSuccess("product"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("product"), error?.message)
  }
};

// ================= Delete Product =================
export const delete_product_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("product id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response = await updateData(productModel, query, { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("product"))
    return sendSuccess(res, response, responseMessage.deleteDataSuccess("product"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to delete product"), error?.message)
  }
};

// ================= Get All Products =================
export const get_all_product = async (req, res) => {
  reqInfo(req)
  try {
    const { page, limit, search, category, billable, sortBy, order, isActive, all } = req.query
    const isAll = String(all || "").toLowerCase() === "true"
    const pageNo = isAll ? 1 : (parseInt(page) || 1)
    const limitNo = isAll ? 0 : (parseInt(limit) || 10)
    const query: any = { isDeleted: false }

    applyMedicalStoreScope(req, query)
    if (category) query.category = category
    if (isActive !== undefined) query.isActive = String(isActive) === "true"
    if (search) {
      const regex = new RegExp(String(search), "i")
      query.$or = [{ name: regex }, { category: regex }]
    }

    const safeSortBy = sortBy === "name" ? "name" : "createdAt"
    const options: any = {
      sort: { [safeSortBy]: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 },
    }

    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo
      options.limit = limitNo
    }

    const productsRaw: any = await getData(productModel, query, {}, options)
    const products = await productModel.populate(productsRaw, [{ path: "userId", select: "name email role" }])
    const total = await countData(productModel, query)

    const resolvedLimit = isAll ? (total || 1) : limitNo
    const totalPages = isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo)

    return sendSuccess(res, {
      products,
      pagination: {
        page: pageNo,
        limit: resolvedLimit,
        total,
        totalPages
      }
    }, responseMessage.getDataSuccess("products"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch products"), error?.message)
  }
};

// ================= Get My Products =================
export const get_my_product = async (req, res) => {
  reqInfo(req)
  try {
    const query: any = { isDeleted: false }
    applyMedicalStoreScope(req, query)
    const productsRaw: any = await getData(productModel, query)
    const products = await productModel.populate(productsRaw, [{ path: "userId", select: "name email role" }])
    return sendSuccess(res, { products }, responseMessage.getDataSuccess("my products"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch my products"), error?.message)
  }
};

// ================= Get Product By Id =================
export const get_product_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("product id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response: any = await findOneAndPopulate(productModel, query, {}, {}, [{ path: "userId", select: "name email role" }])
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("product"))
    return sendSuccess(res, response, responseMessage.getDataSuccess("product"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch product"), error?.message)
  }
};

// ================= Toggle Product Active Status =================
export const toggle_product_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = productValidation.toggleProductStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("product id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response = await updateData(productModel, query, { isActive: value.isActive }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("product"))
    return sendSuccess(res, response, value.isActive ? responseMessage.customMessage("product activated successfully") : responseMessage.customMessage("product deactivated successfully"))
  } catch (error) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("product status"), error?.message)
  }
};
