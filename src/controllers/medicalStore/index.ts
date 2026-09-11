import mongoose from "mongoose";
import { responseMessage, status_code } from "../../common";
import { storeModel } from "../../database";
import { reqInfo, sendError, sendSuccess } from "../../helper";
import { commonValidation, medicalStoreValidation } from "../../validation";
import {getData,getFirstMatch,createData,countData,updateData, } from "../../helper/database_service";

const ObjectId = mongoose.Types.ObjectId;

const extractFileNameFromValue = (value: any) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
};

const buildSignaturePayload = (fileName: string) => ({
  path: fileName,
  filename: fileName,
  originalName: fileName,
  size: 0,
  mimetype: "",
});

const emptySignaturePayload = () => ({ path: "",filename: "", originalName: "",size: 0,mimetype: "",});

// ================= Add New Medical Store =================
export const add_medical_store = async (req, res) => {
  reqInfo(req)
  try {
    const { error, value } = medicalStoreValidation.addMedicalStoreValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    const existing = await getFirstMatch(storeModel, { name: { $regex: `^${value.name.trim()}$`, $options: "si" }, sDeleted: false,})
    if (existing) return sendError(res, status_code.BAD_REQUEST, responseMessage.dataAlreadyExist("medical store"))

    value.signatureImg = extractFileNameFromValue(value.signatureImg) ? buildSignaturePayload(extractFileNameFromValue(value.signatureImg)) : emptySignaturePayload()
    if (value.taxPercent !== undefined) value.taxPercent = Number(value.taxPercent)

    const response = await createData(storeModel, value)
    return sendSuccess(res, response, responseMessage.addDataSuccess("medical store"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to add medical store", err)
  }
};

// ================= Update Medical Store =================
export const update_medical_store_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = medicalStoreValidation.medicalStoreUpdateDataValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("medical store id"))

    const removeSignature = value.removeSignature === true || value.removeSignature === "true" || value.removeSignature === "1"
    const signatureFileName = extractFileNameFromValue(value.signatureImg)
    if (value.taxPercent !== undefined) value.taxPercent = Number(value.taxPercent)
    if (removeSignature) value.signatureImg = emptySignaturePayload()
    else if (signatureFileName) value.signatureImg = buildSignaturePayload(signatureFileName)
    else delete value.signatureImg
    delete value.removeSignature

    const response = await updateData(storeModel, { _id: id, isDeleted: false }, value, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("medical store"))
    return sendSuccess(res, response, responseMessage.updateDataSuccess("medical store"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to update medical store", err)
  }
};

// ================= Delete Medical Store =================
export const delete_medical_store_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("medical store id"))

    const response = await updateData(storeModel, { _id: id, isDeleted: false }, { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("medical store"))
    return sendSuccess(res, response, responseMessage.deleteDataSuccess("medical store"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to delete medical store", err)
  }
};

// ================= Get All Medical Stores =================
export const get_all_medical_store = async (req, res) => {
  reqInfo(req)
  try {
    const { page, limit, search, isActive, all } = req.query
    const isAll = String(all || "").toLowerCase() === "true"
    const pageNo = isAll ? 1 : (parseInt(page as string) || 1)
    const limitNo = isAll ? 0 : (parseInt(limit as string) || 10)
    const query: any = { isDeleted: false }

    if (search) query.name = { $regex: search, $options: "si" }
    if (isActive !== undefined) query.isActive = String(isActive) === "true"

    const total = await countData(storeModel, query)
    const options: any = { sort: { createdAt: -1 } }
    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo
      options.limit = limitNo
    }
    const stores = await getData(storeModel, query, {}, options)

    return sendSuccess(res, {
      stores,
      pagination: {
        page: pageNo,
        limit: isAll ? (total || 1) : limitNo,
        total,
        totalPages: isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo)
      },
    }, responseMessage.getDataSuccess("medical stores"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to fetch medical stores", err)
  }
};

// ================= Get Medical Store By Id =================
export const get_medical_store_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("medical store id"))

    const response = await getFirstMatch(storeModel, { _id: id, isDeleted: false })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("medical store"))
    return sendSuccess(res, response, responseMessage.getDataSuccess("medical store"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to fetch medical store", err)
  }
};

// ================= Toggle Medical Store Status =================
export const toggle_medical_store_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = medicalStoreValidation.toggleMedicalStoreStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("medical store id"))

    const response = await updateData(storeModel, { _id: id, isDeleted: false }, { isActive: value.isActive }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("medical store"))
    return sendSuccess(res, response, "Medical store status updated")
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, "Failed to update status", err)
  }
};
