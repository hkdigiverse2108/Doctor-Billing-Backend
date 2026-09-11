import mongoose from "mongoose";
import { responseMessage, ROLES, status_code } from "../../common";
import { financialModel, userModel } from "../../database";
import { applyMedicalStoreScope, countData, createData, endOfDay, findOneAndPopulate, getData, getFirstMatch, reqInfo, resolveUserMedicalStoreId, sendError, sendSuccess, startOfDay, titleCase, updateData } from "../../helper";
import { commonValidation, financialValidation } from "../../validation";

// ================= Add New fiadd_financial =================
export const add_financial = async (req, res) => {
    reqInfo(req)
    try {
        const { error, value } = financialValidation.financialDataValidation.validate(req.body, commonValidation.joiValidationOptions)
        if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

        value.name = titleCase(String(value.name || "").trim())

        let ownerId = req.user._id, medicalStoreId: any = req.user?.medicalStoreId
        if (req.user.role === ROLES.admin) {
            if (!value.userId) return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("please select user"))

            const ownerUser = await getFirstMatch(userModel, { _id: value.userId, isDeleted: false }, { medicalStoreId: 1 })
            if (!ownerUser) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("user"))

            ownerId = ownerUser._id
            medicalStoreId = ownerUser.medicalStoreId
        }

        const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim()
        if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
            return sendError(res, status_code.BAD_REQUEST, req.user.role === ROLES.admin ? responseMessage.customMessage("selected user has no medical store assigned") : responseMessage.customMessage("medical store is not assigned to current user"))
        }

        const response = await createData(financialModel, {
            ...value,
            userId: ownerId,
            medicalStoreId: storeId,
            isActive: true,
        })
        return sendSuccess(res, response, responseMessage.addDataSuccess("financial"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to add financial"), error?.message)
    }
};


// ================= Update fiadd_financial =================
export const update_financial_by_id = async (req, res) => {
    reqInfo(req)
    try {
        const { id } = req.params
        const { error, value } = financialValidation.financialUpdateDataValidation.validate(req.body, commonValidation.joiValidationOptions)
        if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

        if (value.name) value.name = titleCase(String(value.name).trim())

        if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("financial id"))

        const query: any = { _id: id, isDeleted: false }
        applyMedicalStoreScope(req, query)

        const existing: any = await getFirstMatch(financialModel, query)
        if (!existing) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("financial"))

        // If admin is changing product ownership, validate the selected user and derive the correct medical store.
        if (req.user.role === ROLES.admin && value.userId) {
            const ownerUser: any = await getFirstMatch(
                userModel,
                { _id: value.userId, isDeleted: false, role: { $ne: ROLES.admin } },
                { _id: 1, medicalStoreId: 1 }
            );
            if (!ownerUser) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"));

            const resolvedStoreId =
                (ownerUser.medicalStoreId && String(ownerUser.medicalStoreId));

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

        const response = await updateData(financialModel, query, { ...value }, { new: true })
        if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.updateDataError("financial"))
        return sendSuccess(res, response, responseMessage.updateDataSuccess("financial"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("financial"), error?.message)
    }
};

// ================= Delete fiadd_financial =================
export const delete_financial_by_id = async (req, res) => {
    reqInfo(req)
    try {
        const { id } = req.params
        if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("financial id"))

        const query: any = { _id: id, isDeleted: false }
        applyMedicalStoreScope(req, query)

        const response = await updateData(financialModel, query, { isDeleted: true }, { new: true })
        if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("financial"))
        return sendSuccess(res, response, responseMessage.deleteDataSuccess("financial"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to delete financial"), error?.message)
    }
};

// ================= Get All fiadd_financial =================
export const get_all_financial = async (req, res) => {
    reqInfo(req)
    try {
        const { page, limit, search, sortBy, order, isActive, all, type, fromDate, toDate } = req.query
        const isAll = String(all || "").toLowerCase() === "true"
        const pageNo = isAll ? 1 : (parseInt(page) || 1)
        const limitNo = isAll ? 0 : (parseInt(limit) || 10)
        const query: any = { isDeleted: false }

        applyMedicalStoreScope(req, query)
        if (type) query.type = type
        if (isActive !== undefined) query.isActive = String(isActive) === "true"
        if (search) {
            const regex = new RegExp(String(search), "i")
            query.$or = [{ name: regex }, { from: regex }, { description: regex }]
        }

        if (fromDate || toDate) {
            const filter: any = {}
            if (fromDate) filter.$gte = startOfDay(new Date(fromDate as string))
            if (toDate) filter.$lte = endOfDay(new Date(toDate as string))
            if (filter.$gte && filter.$lte && filter.$gte > filter.$lte) {
                return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("fromDate cannot be greater than toDate"))
            }
            query.date = filter
        }

        const safeSortBy = sortBy === "name" ? "name" : "createdAt"
        const options: any = {
            sort: { [safeSortBy]: String(order || "desc").toLowerCase() === "asc" ? 1 : -1 },
        }

        if (!isAll) {
            options.skip = (pageNo - 1) * limitNo
            options.limit = limitNo
        }

        const productsRaw: any = await getData(financialModel, query, {}, options)
        const fiadd_financial = await financialModel.populate(productsRaw, [{ path: "userId", select: "name email role" }])
        const total = await countData(financialModel, query)

        const resolvedLimit = isAll ? (total || 1) : limitNo
        const totalPages = isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo)

        return sendSuccess(res, {
            fiadd_financial,
            pagination: {
                page: pageNo,
                limit: resolvedLimit,
                total,
                totalPages
            }
        }, responseMessage.getDataSuccess("fiadd_financial"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch fiadd_financial"), error?.message)
    }
};


// ================= Get My fiadd_financial =================
export const get_my_financial = async (req, res) => {
    reqInfo(req)
    try {
        const query: any = { isDeleted: false }
        applyMedicalStoreScope(req, query)
        const productsRaw: any = await getData(financialModel, query)
        const products = await financialModel.populate(productsRaw, [{ path: "userId", select: "name email role" }])
        return sendSuccess(res, { products }, responseMessage.getDataSuccess("my financial"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch my financial"), error?.message)
    }
};

// ================= Get fiadd_financial By Id =================
export const get_financial_by_id = async (req, res) => {
    reqInfo(req)
    try {
        const { id } = req.params
        if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("financial id"))

        const query: any = { _id: id, isDeleted: false }
        applyMedicalStoreScope(req, query)

        const response: any = await findOneAndPopulate(financialModel, query, {}, {}, [{ path: "userId", select: "name email role" }])
        if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("financial"))
        return sendSuccess(res, response, responseMessage.getDataSuccess("product"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch financial"), error?.message)
    }
};

// ================= Toggle fiadd_financial Active Status =================
export const toggle_financial_active_status = async (req, res) => {
    reqInfo(req)
    try {
        const { id } = req.params
        const { error, value } = financialValidation.toggleFinancialStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
        if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
        if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("financial id"))

        const query: any = { _id: id, isDeleted: false }
        applyMedicalStoreScope(req, query)

        const response = await updateData(financialModel, query, { isActive: value.isActive }, { new: true })
        if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("financial"))
        return sendSuccess(res, response, value.isActive ? responseMessage.customMessage("financial activated successfully") : responseMessage.customMessage("product deactivated successfully"))
    } catch (error) {
        return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("financial status"), error?.message)
    }
};
