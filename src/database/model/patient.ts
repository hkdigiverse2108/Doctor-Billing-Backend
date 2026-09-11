import mongoose from "mongoose";
import { modelName } from "../../common";

const paymentHistorySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    type: { type: String, enum: ["Paid", "Due"], required: true },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, default: "Cash" },
    notes: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: false }
);

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactNumber: { type: String, default: "", trim: true },
    bloodGroup: { type: String, default: "", trim: true },
    disease: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    totalDue: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["Due", "Paid", "Partial"],
      default: "Due",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: modelName.userModelName,
      required: true,
    },
    medicalStoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: modelName.storeModelName,
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    paymentHistory: [paymentHistorySchema],
  },
  { timestamps: true, versionKey: false }
);

export const patientModel = mongoose.model(
  modelName.patientModelName,
  patientSchema
);
