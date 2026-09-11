import Joi from "joi";
import { objectIdField } from "./common";

// ================= Add Patient Validation =================
export const patientDataValidation = Joi.object({
  name: Joi.string().required(),
  contactNumber: Joi.string()
    .trim()
    .pattern(/^[0-9]{10}$/)
    .allow("", null)
    .messages({
      "string.pattern.base": "Contact number must be exactly 10 digits",
    }),
  bloodGroup: Joi.string().optional().allow("", null),
  disease: Joi.string().optional().allow("", null),
  notes: Joi.string().optional().allow("", null),
  initialDue: Joi.number().min(0).optional().default(0),
  initialPaid: Joi.number().min(0).optional().default(0),
  userId: objectIdField.optional(),
  medicalStoreId: objectIdField.optional(),
});

// ================= Update Patient Validation =================
export const patientUpdateDataValidation = Joi.object({
  name: Joi.string().optional(),
  contactNumber: Joi.string()
    .trim()
    .pattern(/^[0-9]{10}$/)
    .allow("", null)
    .messages({
      "string.pattern.base": "Contact number must be exactly 10 digits",
    }),
  bloodGroup: Joi.string().optional().allow("", null),
  disease: Joi.string().optional().allow("", null),
  notes: Joi.string().optional().allow("", null),
  userId: objectIdField.optional(),
  medicalStoreId: objectIdField.optional(),
});

// ================= Toggle Status Validation =================
export const togglePatientStatusValidation = Joi.object({
  isActive: Joi.boolean().required(),
});

// ================= Add Patient Payment Validation =================
export const addPatientPaymentValidation = Joi.object({
  patientId: objectIdField.required(),
  amount: Joi.number().min(0.01).required(),
  type: Joi.string().valid("Paid", "Due").required(),
  date: Joi.date().optional(),
  paymentMethod: Joi.string().optional().allow("", null),
  notes: Joi.string().optional().allow("", null),
});
