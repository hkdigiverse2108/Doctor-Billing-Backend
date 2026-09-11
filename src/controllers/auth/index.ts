import { userModel, otpModel } from "../../database";
import bcrypt from "bcryptjs";
import { responseMessage, status_code } from "../../common";
import { authValidation, commonValidation } from "../../validation";
import { deleteFileIfExists, sendSuccess, sendError, otpSender, buildOtpEmailTemplate, } from "../../helper";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { config } from "../../../config";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: config.EMAIL,
    pass: config.PASS,
  },
});

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const deactivatedMsg = "Your account is deactivated. Please contact admin.";

const extractFileNameFromValue = (value: any) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
};

const getExistingSignatureName = (signatureImg: any) => {
  if (!signatureImg) return "";
  if (typeof signatureImg === "string") return extractFileNameFromValue(signatureImg);
  return extractFileNameFromValue(signatureImg.filename || signatureImg.path || "");
};

const buildSignaturePayload = (fileName: string) => ({
  path: fileName,
  filename: fileName,
  originalName: fileName,
  size: 0,
  mimetype: "",
});

const emptySignaturePayload = () => ({
  path: "",
  filename: "",
  originalName: "",
  size: 0,
  mimetype: "",
});


// ============== Signin controller ==========================
export const signIn = async (req, res) => {
  const { error, value } = authValidation.signInValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );
  if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

  try {
    const { email, password } = value;

    const user = await userModel.findOne({ email, isDeleted: false });
    if (!user) return sendError(res, status_code.BAD_REQUEST, responseMessage.userNotFound);

    if (user.isActive === false) return sendError(res, status_code.FORBIDDEN, deactivatedMsg);
    const match = bcrypt.compareSync(password, user.password);
    if (!match) return sendError(res, status_code.BAD_REQUEST, responseMessage.incorrectPassword);

    const isOtpSent = await otpSender(email);

    return sendSuccess(res, { isOtpSent }, responseMessage.signIn_successful);
  } catch (err) {
    return sendError(res, status_code.INTERNAL_SERVER_ERROR, responseMessage.signIn_failed, err);
  }
};

// ============== Signout controller ==========================
export const signout = async (req, res) => {
  return sendSuccess(res, {}, responseMessage.signOut_SuccessFull);
};


// ============== verify otp controller ==========================
export const verifyOTP = async (req, res) => {
  const { error, value } = authValidation.verifyOtpValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );

  if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

  try {
    const { email, otp, purpose = "signin" } = value;

    const record = await otpModel.findOne({ email, purpose } as any).sort({ createdAt: -1 });

    if (!record) {
      const msg = purpose === "reset" ? responseMessage.forgotPassword_otp_invalid : "OTP is incorrect !";
      return sendError(res, status_code.BAD_REQUEST, msg);
    }

    if (record.expireAt < new Date()) {
      await otpModel.deleteMany({ email, purpose } as any);
      const msg = purpose === "reset" ? responseMessage.forgotPassword_otp_expired : "OTP is expired !";
      return sendError(res, status_code.BAD_REQUEST, msg);
    }

    const isValid = purpose === "reset" ? bcrypt.compareSync(otp, record.otp) : record.otp.toString() === otp.toString();

    if (!isValid) {
      const msg = purpose === "reset" ? responseMessage.forgotPassword_otp_invalid : "OTP is incorrect !";
      return sendError(res, status_code.BAD_REQUEST, msg);
    }

    if (purpose === "reset") {
      return sendSuccess(res, {}, responseMessage.forgotPassword_otp_verified);
    }

    await otpModel.deleteMany({ email, purpose: "signin" } as any);
    const user = await userModel.findOne({ email, isDeleted: false });
    if (!user) return sendError(res, status_code.BAD_REQUEST, responseMessage.userNotFound);
    if (user.isActive === false) return sendError(res, status_code.FORBIDDEN, deactivatedMsg);

    const token = jwt.sign(
      { user: { _id: user._id, name: user.name, email: user.email, role: user.role } },
      config.SECRET_KEY,
      { expiresIn: "24h" }
    );

    return sendSuccess(res, { user, token }, responseMessage.otp_verifyAndSignin);
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.otp_invalid, err.message);
  }
};

// ============== update profile controller ==========================
export const updateProfile = async (req, res) => {
  const { error, value } = authValidation.updateProfileValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );
  if (error) {
    return sendError(res, status_code.BAD_REQUEST, error.details[0].message);
  }

  try {
    const userId = (req as any).user._id;
    const updateData: any = { ...value };
    const existing: any = await userModel.findById(userId).select("signatureImg");

    const removeSignatureValue = value?.removeSignature;
    const shouldRemoveSignature =
      removeSignatureValue === true ||
      removeSignatureValue === "true" ||
      removeSignatureValue === "1";

    if (shouldRemoveSignature) {
      deleteFileIfExists(existing?.signatureImg);
      updateData.signatureImg = emptySignaturePayload();
    }

    if (!shouldRemoveSignature && req.body.signatureImg) {
      const newSig = extractFileNameFromValue(req.body.signatureImg);
      const oldSig = getExistingSignatureName(existing?.signatureImg);
      if (newSig && newSig !== oldSig) {
        deleteFileIfExists(existing?.signatureImg);
        updateData.signatureImg = buildSignaturePayload(newSig);
      }
    }

    if (value.email) {
      const exists = await userModel.findOne({
        email: value.email, _id: { $ne: userId },
      });
      if (exists) {
        return sendError(res, status_code.BAD_REQUEST, "Email already in use by another account");
      }
    }

    const updated: any = await userModel.findByIdAndUpdate(userId, updateData, { new: true }).select("-password");

    if (!updated) {
      return sendError(res, status_code.NOT_FOUND, "User not found");
    }

    const token = jwt.sign(
      { user: { _id: updated._id, name: updated.name, email: updated.email, role: updated.role } },
      config.SECRET_KEY,
      { expiresIn: "1d" }
    );

    return sendSuccess(res, { user: updated, token }, "Profile updated successfully");
  } catch (err: any) {
    return sendError(res, status_code.INTERNAL_SERVER_ERROR, "Failed to update profile", err.message);
  }
};

// ============== Forget Passworrd controller ==========================
export const sendForgotPasswordOtp = async (req, res) => {
  const { error, value } = authValidation.forgotPasswordSendOtpValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );
  if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

  try {
    const { email } = value;
    const user = await userModel.findOne({ email, isDeleted: false });
    if (!user) return sendError(res, status_code.NOT_FOUND, responseMessage.userNotFound);

    const otp = generateOtp();
    const hash = bcrypt.hashSync(otp, 10);
    const expireAt = new Date(Date.now() + 1000 * 60 * 3);

    await otpModel.deleteMany({ email, purpose: "reset" } as any);
    await otpModel.create({ email, otp: hash, expireAt, purpose: "reset" } as any);

    const html = buildOtpEmailTemplate({
      otp,
      recipientName: user.name,
      purposeText: "password reset",
      supportEmail: config.EMAIL || "support@medicobilling.com",
      brandName: "Medico Billing",
      validMinutes: 3,
      logoUrl: config.APP_LOGO_URL,
    });

    await transporter.sendMail({
      from: `Security Team <${config.EMAIL}>`,
      to: email,
      subject: "Password Reset OTP",
      html,
    });

    return sendSuccess(res, {}, responseMessage.forgotPassword_otp_sent);
  } catch (err) {
    return sendError(res, status_code.INTERNAL_SERVER_ERROR, responseMessage.forgotPassword_otp_verify_failed, err.message);
  }
};

// ==============Reset Forget Passworrd controller ==========================
export const resetForgotPassword = async (req, res) => {
  const { error, value } = authValidation.forgotPasswordResetValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );
  if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

  try {
    const { email, otp, newPassword, confirmPassword } = value;
    if (newPassword !== confirmPassword) {
      return sendError(res, status_code.BAD_REQUEST, responseMessage.password_confirm_mismatch);
    }

    const user = await userModel.findOne({ email, isDeleted: false });
    if (!user) return sendError(res, status_code.NOT_FOUND, responseMessage.userNotFound);

    const record: any = await otpModel.findOne({ email, purpose: "reset" } as any).sort({ createdAt: -1 });

    if (!record) return sendError(res, status_code.BAD_REQUEST, responseMessage.forgotPassword_otp_invalid);

    if (record.expireAt < new Date()) {
      await otpModel.deleteMany({ email, purpose: "reset" } as any);
      return sendError(res, status_code.BAD_REQUEST, responseMessage.forgotPassword_otp_expired);
    }

    const isMatch = bcrypt.compareSync(otp, record.otp);
    if (!isMatch) return sendError(res, status_code.BAD_REQUEST, responseMessage.forgotPassword_otp_invalid);

    user.password = bcrypt.hashSync(newPassword, 12);
    await user.save();
    await otpModel.deleteMany({ email, purpose: "reset" } as any);

    return sendSuccess(res, {}, responseMessage.forgotPassword_reset_success);
  } catch (err) {
    return sendError(res, status_code.INTERNAL_SERVER_ERROR, responseMessage.forgotPassword_reset_failed, err.message);
  }
};

// ============== Change Passworrd controller ==========================
export const changePassword = async (req, res) => {
  const { error, value } = authValidation.changePasswordValidation.validate(
    req.body,
    commonValidation.joiValidationOptions
  );
  if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

  try {
    const userId = (req as any).user?._id;
    const { oldPassword, newPassword, confirmPassword } = value;
    if (newPassword !== confirmPassword) {
      return sendError(res, status_code.BAD_REQUEST, responseMessage.password_confirm_mismatch);
    }

    const user: any = await userModel.findById(userId);
    if (!user) return sendError(res, status_code.NOT_FOUND, responseMessage.userNotFound);

    const match = bcrypt.compareSync(oldPassword, user.password);
    if (!match) return sendError(res, status_code.BAD_REQUEST, responseMessage.oldPassword_incorrect);

    user.password = bcrypt.hashSync(newPassword, 12);
    await user.save();

    return sendSuccess(res, {}, responseMessage.changePassword_success);
  } catch (err) {
    return sendError(res, status_code.INTERNAL_SERVER_ERROR, responseMessage.changePassword_failed, err.message);
  }
};
