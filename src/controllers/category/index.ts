import { responseMessage, ROLES, status_code } from "../../common";
import { userModel, categoryModel } from "../../database";
import { applyMedicalStoreScope, buildRoleQuery, countData, createData, findOneAndPopulate, getData, getFirstMatch, reqInfo, resolveUserMedicalStoreId, sendError, sendSuccess, titleCase, updateData } from "../../helper";
import { categoryValidation, commonValidation } from "../../validation";
import mongoose from "mongoose";


// ============== Add Category controller ==========================
export const add_category = async (req, res) => {
  reqInfo(req)
  try {
    const { error, value } = categoryValidation.addCategoryValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    let ownerUserId = req.user._id, medicalStoreId: any = req.user?.medicalStoreId
    if (req.user.role === ROLES.admin) {
      if (!value.userId) return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("please select user"))
      const ownerUser: any = await userModel.findOne({ _id: value.userId, isDeleted: false, role: { $ne: ROLES.admin } }, { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 })
      if (!ownerUser) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"))

      ownerUserId = ownerUser._id
      medicalStoreId = ownerUser.medicalStoreId || (Array.isArray(ownerUser.medicalStoreIds) ? ownerUser.medicalStoreIds[0]?._id || ownerUser.medicalStoreIds[0] : null)
    }

    const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim()
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return sendError(res, status_code.BAD_REQUEST, req.user.role === ROLES.admin ? responseMessage.customMessage("selected user has no medical store assigned") : responseMessage.customMessage("medical store is not assigned to current user"))
    }

    const normalized = titleCase(value.name.trim())
    const exists = await getFirstMatch(categoryModel, {
      medicalStoreId: storeId,
      name: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      isDeleted: false,
    })
    if (exists) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("category"))

    const response = await createData(categoryModel, { userId: ownerUserId, medicalStoreId: storeId, name: normalized, isActive: true })
    return sendSuccess(res, response, responseMessage.addDataSuccess("category"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to add category"), err)
  }
};

// ============== update Category controller ==========================
export const update_category_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const payload = { ...req.body, id: req.params.id || req.body.id }
    const { error, value } = categoryValidation.updateCategoryValidation.validate(payload, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(value.id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("category id"))

    if (req.user.role !== ROLES.admin && value.medicalStoreId) {
      const currentUserMedicalStoreId = resolveUserMedicalStoreId(req)
      if (!currentUserMedicalStoreId || currentUserMedicalStoreId !== String(value.medicalStoreId)) {
        return sendError(res, status_code.FORBIDDEN, responseMessage.customMessage("not authorized for selected medical store"))
      }
    }

    const query: any = { _id: value.id, isDeleted: false }
    applyMedicalStoreScope(req, query)
    if (req.user.role === ROLES.admin && value.medicalStoreId && mongoose.Types.ObjectId.isValid(value.medicalStoreId)) query.medicalStoreId = value.medicalStoreId

    const existing: any = await getFirstMatch(categoryModel, query)
    if (!existing) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("category"))

    const normalized = titleCase(value.name.trim())
    if (normalized !== existing.name) {
      const isExist = await getFirstMatch(categoryModel, {
        medicalStoreId: existing.medicalStoreId,
        name: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        isDeleted: false,
        _id: { $ne: value.id },
      })
      if (isExist) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("category name"))
    }

    const updatePayload: any = { name: normalized }
    if (req.user.role === "admin" && value.medicalStoreId && mongoose.Types.ObjectId.isValid(value.medicalStoreId)) {
      updatePayload.medicalStoreId = value.medicalStoreId
    }
    const response = await updateData(categoryModel, { _id: value.id }, updatePayload, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.updateDataError("category"))
    return sendSuccess(res, response, responseMessage.updateDataSuccess("category"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("category"), err)
  }
};

// ============== Delete Category controller ==========================
export const delete_category_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("category id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response = await updateData(categoryModel, query, { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("category"))
    return sendSuccess(res, response, responseMessage.deleteDataSuccess("category"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to delete category"), err)
  }
};

// ============== Get Categories controller ==========================
export const get_all_category = async (req, res) => {
  reqInfo(req)
  try {
    const { page, limit, search, addedBy, sortBy, order, medicalStoreId, isActive, all } = req.query
    const isAll = String(all || "").toLowerCase() === "true"
    const pageNo = isAll ? 1 : (parseInt(page) || 1)
    const limitNo = isAll ? 0 : (parseInt(limit) || 10)
    const query: any = buildRoleQuery(req.user.role, req.user._id, medicalStoreId as string, req.user.medicalStoreId)

    if (req.user.role === ROLES.admin && addedBy && mongoose.Types.ObjectId.isValid(addedBy as string)) query.userId = addedBy
    if (isActive !== undefined) query.isActive = String(isActive) === "true"
    if (search) query.$or = [{ name: { $regex: search, $options: "si" } }]

    const options: any = {
      sort: sortBy === "addedBy" ? { userId: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 } : { createdAt: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 },
    }

    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo
      options.limit = limitNo
    }

    const categoriesRaw: any = await getData(categoryModel, query, {}, options)
    const categoriesPopulated: any = await categoryModel.populate(categoriesRaw, [{ path: "userId", select: "name email" }])
    const total = await countData(categoryModel, query)
    const data = categoriesPopulated.map((c: any) => (typeof c.toObject === "function" ? c.toObject() : c))

    const resolvedLimit = isAll ? (total || 1) : limitNo
    const totalPages = isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo)

    return sendSuccess(res, {
      data,
      pagination: {
        page: pageNo,
        limit: resolvedLimit,
        total,
        totalPages
      }
    }, responseMessage.getDataSuccess("categories"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch categories"), err)
  }
};

// ============== Get Single Category by id controller ==========================
export const get_category_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("category id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response: any = await findOneAndPopulate(categoryModel, query, {}, {}, { path: "userId", select: "name email" })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("category"))
    return sendSuccess(res, response, responseMessage.getDataSuccess("category"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch category"), err)
  }
};

// ============== Acive Category controller ==========================
export const toggle_category_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = categoryValidation.toggleCategoryStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("category id"))

    const query: any = { _id: id, isDeleted: false }
    applyMedicalStoreScope(req, query)

    const response = await updateData(categoryModel, query, { isActive: value.isActive }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("category"))
    return sendSuccess(res, response, value.isActive ? responseMessage.customMessage("category activated successfully") : responseMessage.customMessage("category deactivated successfully"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("category status"), err)
  }
};
