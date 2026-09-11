import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { responseMessage, ROLES, status_code } from "../../common";
import { userModel } from "../../database";
import { commonValidation, userValidation } from "../../validation";
import { countData, createData, getData, getFirstMatch, reqInfo, sendError, sendSuccess, updateData } from "../../helper";

const ObjectId = mongoose.Types.ObjectId;

// ================= Add New User =================
export const add_user = async (req, res) => {
  reqInfo(req)
  try {
    const { error, value } = userValidation.addUserValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    const exists = await getFirstMatch(userModel, { email: value.email, isDeleted: false })
    if (exists) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("user"))

    const hashedPassword = await bcrypt.hash(value.password, 10)
    value.password = hashedPassword

    const response = await createData(userModel, value)
    return sendSuccess(res, response, responseMessage.addDataSuccess("user"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to add user", err)
  }
};

// ================= Update User =================
export const update_user_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = userValidation.userValidaiton.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("user id"))

    const response = await updateData(userModel, { _id: id, isDeleted: false }, value, { new: true, select: "-password" })

    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("user"))
    return sendSuccess(res, response, responseMessage.updateDataSuccess("user"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to update user", err)
  }
};

// ================= Delete User =================
export const delete_user_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("user id"))

    const response = await updateData(userModel, { _id: id, isDeleted: false }, { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("user"))
    return sendSuccess(res, response, responseMessage.deleteDataSuccess("user"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to delete user", err)
  }
};

// ================= Get All Users =================
export const get_all_user = async (req, res) => {
  reqInfo(req)
  try {
    const { page, limit, search, isActive, all } = req.query
    const isAll = String(all || "").toLowerCase() === "true"
    const pageNo = isAll ? 1 : (parseInt(page as string) || 1)
    const limitNo = isAll ? 0 : (parseInt(limit as string) || 10)
    const query: any = { isDeleted: false, role: { $ne: ROLES.admin } }

    if (search) query.$or = [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }]
    if (isActive !== undefined) query.isActive = String(isActive) === "true"

    const total = await countData(userModel, query)
    const options: any = { sort: { createdAt: -1 } }
    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo
      options.limit = limitNo
    }
    const users = await getData(userModel, query, "-password", options)

    return sendSuccess(res, {
      users,
      pagination: {
        page: pageNo,
        limit: isAll ? (total || 1) : limitNo,
        total,
        totalPages: isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo)
      },
    }, responseMessage.getDataSuccess("users"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to fetch users", err)
  }
};

// ================= Get User By Id =================
export const get_user_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("user id"))

    const response = await getFirstMatch(userModel, { _id: id, isDeleted: false }, "-password")
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("user"))
    return sendSuccess(res, response, responseMessage.getDataSuccess("user"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to fetch user", err)
  }
};

// ================= Toggle User Status =================
export const toggle_user_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = userValidation.toggleUserStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("user id"))

    const response = await updateData(userModel, { _id: id, isDeleted: false }, { isActive: value.isActive }, { new: true, select: "-password" })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("user"))
    return sendSuccess(res, response, "User status updated")
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to update status", err)
  }
};
