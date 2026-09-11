import { userModel, companyModel } from "../../database";
import { commonValidation, companyValidation } from "../../validation";
import { responseMessage, ROLES, status_code } from "../../common";
import { sendSuccess, sendError, deleteFileIfExists, resolveUserMedicalStoreId, applyMedicalStoreScope, reqInfo, titleCase } from "../../helper";
import mongoose from "mongoose";
import { getData, getFirstMatch, countData, createData, updateData, findOneAndPopulate } from "../../helper/database_service";

// ================= Add New Company =================
export const add_company = async (req, res) => {
  reqInfo(req);
  try {
    const { error, value } = companyValidation.companyDataValidation.validate(req.body, commonValidation.joiValidationOptions);
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

    value.name = titleCase(String(value.name || "").trim());

    if (req.user.role === ROLES.user) {
      value.userId = req.user._id;
      value.medicalStoreId = req.user.medicalStoreId;
    }

    if (req.user.role === ROLES.admin) {
      if (!value.userId) return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("please select user"));

      const selectedUser: any = await userModel.findOne( { _id: value.userId, isDeleted: false, role: { $ne: ROLES.admin } }, { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 });
      if (!selectedUser) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"));

      value.userId = selectedUser._id;
      value.medicalStoreId =
        selectedUser.medicalStoreId ||
        (Array.isArray(selectedUser.medicalStoreIds)
          ? selectedUser.medicalStoreIds[0]?._id || selectedUser.medicalStoreIds[0]
          : null);
    }

    const medicalStoreId = String(value.medicalStoreId?._id || value.medicalStoreId || "").trim();
    if (!medicalStoreId || !mongoose.Types.ObjectId.isValid(medicalStoreId)) {
      return sendError(
        res,
        status_code.BAD_REQUEST,
        req.user.role === ROLES.admin
          ? responseMessage.customMessage("selected user has no medical store assigned")
          : responseMessage.customMessage("medical store is not assigned to current user")
      );
    }

    let isExist = await companyModel.findOne({ name: value.name, userId: value.userId, isDeleted: false });
    if (isExist) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("name"), {});

    if (value.email) {
      isExist = await companyModel.findOne({ email: value.email, userId: value.userId, isDeleted: false });
      if (isExist) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("email"), {});
    }

    const response = await createData(companyModel, {
      ...value,
      medicalStoreId,
      logoImage: req.body.logoImage?.toString().split("/").pop() || null,
      isActive: true,
    });

    return sendSuccess(res, response, responseMessage.addDataSuccess("company"));
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to add company"), err?.message);
  }
};

// ================= Update Company =================
export const update_company_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = companyValidation.companyUpdateDataValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    if (value.name) value.name = titleCase(String(value.name).trim())

    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("company id"))

    const query: any = { _id: new mongoose.Types.ObjectId(id), isDeleted: false }
    applyMedicalStoreScope(req, query, true)

    const existing: any = await getFirstMatch(companyModel, query)
    if (!existing) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("company"))

    if (req.user.role !== ROLES.admin && value.medicalStoreId) {
      const currentUserMedicalStoreId = resolveUserMedicalStoreId(req)
      if (!currentUserMedicalStoreId || currentUserMedicalStoreId !== String(value.medicalStoreId)) {
        return sendError(res, status_code.FORBIDDEN, responseMessage.customMessage("not authorized for selected medical store"))
      }
    }

    let isExist = await companyModel.findOne({ _id: { $ne: existing._id }, name: value.name, userId: existing.userId, isDeleted: false })
    if (isExist) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("name"), {})

    if (value.email) {
      isExist = await companyModel.findOne({ _id: { $ne: existing._id }, email: value.email, userId: existing.userId, isDeleted: false })
      if (isExist) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("email"), {})
    }

    if (req.user.role !== ROLES.admin) delete value.medicalStoreId

    const newLogo = req.body.logoImage?.toString().split("/").pop()
    if (newLogo && newLogo !== existing.logoImage) {
      deleteFileIfExists(existing.logoImage)
      value.logoImage = newLogo
    }

    const response = await updateData(companyModel, query, value, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.updateDataError("company"))

    return sendSuccess(res, response, responseMessage.updateDataSuccess("company"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("company"), err?.message)
  }
};

// ================= Delete Company =================
export const delete_company_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("company id"))
    const query: any = { _id: new mongoose.Types.ObjectId(id) }
    applyMedicalStoreScope(req, query, true)

    const response = await updateData(companyModel, query, { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("company"))
    return sendSuccess(res, response, responseMessage.deleteDataSuccess("company"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to delete company"), err?.message)
  }
};

// ================= Get All Companies =================
export const get_all_company = async (req, res) => {
  reqInfo(req)
  if (!req.user) return sendError(res, status_code.UNAUTHORIZED, responseMessage.notAuthenticated)

  try {
    const { page, limit, search, addedBy, sortBy, order, isActive, all } = req.query
    const isAll = String(all || "").toLowerCase() === "true"
    const pageNo = isAll ? 1 : (parseInt(page) || 1)
    const limitNo = isAll ? 0 : (parseInt(limit) || 10)
    const query: any = { isDeleted: false }

    applyMedicalStoreScope(req, query, true)

    if (req.user.role === ROLES.admin && addedBy && mongoose.Types.ObjectId.isValid(addedBy as string)) {
      query.userId = new mongoose.Types.ObjectId(addedBy as string)
    }

    if (isActive !== undefined) query.isActive = String(isActive) === "true"

    if (search) {
      query.$or = [{ name: { $regex: search, $options: "si" } }]
      if (req.user.role === ROLES.admin) {
        const users: any = await getData(
          userModel,
          { isDeleted: false, $or: [{ name: { $regex: search, $options: "si" } }, { email: { $regex: search, $options: "si" } }] },
          { _id: 1 }
        )
        if (users.length) query.$or.push({ userId: { $in: users.map((u: any) => u._id) } })
      }
    }

    const options: any = {
      sort: sortBy === "addedBy" ? { userId: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 } : { createdAt: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 },
    }

    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo
      options.limit = limitNo
    }

    const companiesRaw: any = await getData(companyModel, query, {}, options)
    const companies: any = await companyModel.populate(companiesRaw, [{ path: "userId", select: "name email" }])
    const total = await countData(companyModel, query)
    const data = companies.map((c: any) => (typeof c.toObject === "function" ? c.toObject() : c))

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
    }, responseMessage.getDataSuccess("companies"))
  } catch (err) {
    console.error("get_all_company error:", err)
    if (err?.name === "CastError") return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("invalid query parameter"), err.message)
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch companies"), err?.message)
  }
};

// ================= Get Company By ID =================
export const get_company_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("company id"))

    const query: any = { _id: new mongoose.Types.ObjectId(id), isDeleted: false }
    applyMedicalStoreScope(req, query, true)

    const response: any = await findOneAndPopulate(companyModel, query, {}, {}, { path: "userId", select: "name email" })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("company"))

    return sendSuccess(res, typeof response.toObject === "function" ? response.toObject() : response, responseMessage.getDataSuccess("company"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch company"), err?.message)
  }
};

// ================= Toggle Company Active Status =================
export const toggle_company_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = companyValidation.toggleCompanyStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("company id"))

    const query: any = { _id: new mongoose.Types.ObjectId(id) }
    applyMedicalStoreScope(req, query, true)

    const response = await updateData(companyModel, query, { isActive: value.isActive }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("company"))
    await response.populate("userId", "name email")

    return sendSuccess(res, response, value.isActive ? responseMessage.customMessage("company activated successfully") : responseMessage.customMessage("company deactivated successfully"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("company status"), err?.message)
  }
};
