import mongoose from "mongoose";
import { responseMessage, ROLES, status_code } from "../../common";
import { patientModel, userModel } from "../../database";
import { applyMedicalStoreScope, countData, createData, endOfDay, findOneAndPopulate, getData, getFirstMatch, reqInfo, sendError, sendSuccess, startOfDay, titleCase, updateData } from "../../helper";
import { commonValidation, patientValidation } from "../../validation";

// Helper function to calculate totals and status
const calculatePatientPaymentTotals = (paymentHistory: any[]) => {
  let totalDue = 0;
  let totalPaid = 0;

  for (const item of paymentHistory || []) {
    if (item.type === "Due") {
      totalDue += Number(item.amount) || 0;
    } else if (item.type === "Paid") {
      totalPaid += Number(item.amount) || 0;
    }
  }

  let paymentStatus: "Due" | "Paid" | "Partial" = "Due";
  if (totalDue <= 0 || totalPaid >= totalDue) {
    paymentStatus = "Paid";
  } else if (totalPaid > 0 && totalPaid < totalDue) {
    paymentStatus = "Partial";
  } else {
    paymentStatus = "Due";
  }

  return { totalDue, totalPaid, paymentStatus };
};

// ================= Add New Patient =================
export const add_patient = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { error, value } = patientValidation.patientDataValidation.validate(
      req.body,
      commonValidation.joiValidationOptions
    );
    if (error)
      return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

    value.name = titleCase(String(value.name || "").trim());
    if (value.disease) value.disease = String(value.disease).trim();
    if (value.contactNumber) value.contactNumber = String(value.contactNumber).trim();
    if (value.notes) value.notes = String(value.notes).trim();

    let ownerId = req.user._id;
    let medicalStoreId: any = req.user?.medicalStoreId;

    if (req.user.role === ROLES.admin) {
      if (!value.userId)
        return sendError(
          res,
          status_code.BAD_REQUEST,
          responseMessage.customMessage("please select user / doctor")
        );

      const ownerUser = await getFirstMatch(
        userModel,
        { _id: value.userId, isDeleted: false },
        { medicalStoreId: 1 }
      );
      if (!ownerUser)
        return sendError(
          res,
          status_code.NOT_FOUND,
          responseMessage.getDataNotFound("user")
        );

      ownerId = ownerUser._id;
      medicalStoreId = ownerUser.medicalStoreId;
    }

    const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim();
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return sendError(
        res,
        status_code.BAD_REQUEST,
        req.user.role === ROLES.admin
          ? responseMessage.customMessage(
              "selected user has no medical store assigned"
            )
          : responseMessage.customMessage(
              "medical store is not assigned to current user"
            )
      );
    }

    const paymentHistory: any[] = [];
    const initialDue = Number(value.initialDue) || 0;
    const initialPaid = Number(value.initialPaid) || 0;

    if (initialDue > 0) {
      paymentHistory.push({
        amount: initialDue,
        type: "Due",
        date: new Date(),
        paymentMethod: "Initial Charge",
        notes: "Initial visit/medicine charge",
        createdAt: new Date(),
      });
    }

    if (initialPaid > 0) {
      paymentHistory.push({
        amount: initialPaid,
        type: "Paid",
        date: new Date(),
        paymentMethod: "Cash",
        notes: "Initial payment",
        createdAt: new Date(),
      });
    }

    const { totalDue, totalPaid, paymentStatus } =
      calculatePatientPaymentTotals(paymentHistory);

    const response = await createData(patientModel, {
      name: value.name,
      contactNumber: value.contactNumber || "",
      bloodGroup: value.bloodGroup || "",
      disease: value.disease || "",
      notes: value.notes || "",
      totalDue,
      totalPaid,
      paymentStatus,
      userId: ownerId,
      medicalStoreId: storeId,
      isActive: true,
      isDeleted: false,
      paymentHistory,
    });

    const result = response?.toObject ? response.toObject() : response;

    return sendSuccess(
      res,
      {
        patient: result,
        data: result,
      },
      responseMessage.addDataSuccess("patient")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to add patient"),
      error?.message
    );
  }
};

// ================= Update Patient =================
export const update_patient_by_id = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { id } = req.params;
    const { error, value } = patientValidation.patientUpdateDataValidation.validate(
      req.body,
      commonValidation.joiValidationOptions
    );
    if (error)
      return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(
        res,
        status_code.BAD_REQUEST,
        responseMessage.invalidId("patient id")
      );

    if (value.name) value.name = titleCase(String(value.name).trim());
    if (value.disease !== undefined) value.disease = String(value.disease).trim();
    if (value.contactNumber !== undefined)
      value.contactNumber = String(value.contactNumber).trim();
    if (value.notes !== undefined) value.notes = String(value.notes).trim();

    const query: any = { _id: id, isDeleted: false };
    applyMedicalStoreScope(req, query);

    const existing: any = await getFirstMatch(patientModel, query);
    if (!existing)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient")
      );

    if (req.user.role === ROLES.admin && value.userId) {
      const ownerUser: any = await getFirstMatch(
        userModel,
        { _id: value.userId, isDeleted: false },
        { _id: 1, medicalStoreId: 1 }
      );
      if (!ownerUser)
        return sendError(
          res,
          status_code.BAD_REQUEST,
          responseMessage.getDataNotFound("selected user")
        );

      const resolvedStoreId =
        ownerUser.medicalStoreId && String(ownerUser.medicalStoreId);

      if (
        !resolvedStoreId ||
        !mongoose.Types.ObjectId.isValid(resolvedStoreId)
      ) {
        return sendError(
          res,
          status_code.BAD_REQUEST,
          responseMessage.customMessage(
            "selected user has no medical store assigned"
          )
        );
      }

      value.userId = ownerUser._id;
      value.medicalStoreId = resolvedStoreId;
    }

    if (req.user.role !== ROLES.admin) {
      delete value.medicalStoreId;
      delete value.userId;
    }

    const response = await updateData(
      patientModel,
      query,
      { ...value },
      { new: true }
    );
    if (!response)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.updateDataError("patient")
      );
    return sendSuccess(
      res,
      response,
      responseMessage.updateDataSuccess("patient")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.updateDataError("patient"),
      error?.message
    );
  }
};

// ================= Delete Patient =================
export const delete_patient_by_id = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(
        res,
        status_code.BAD_REQUEST,
        responseMessage.invalidId("patient id")
      );

    const query: any = { _id: id, isDeleted: false };
    applyMedicalStoreScope(req, query);

    const response = await updateData(
      patientModel,
      query,
      { isDeleted: true },
      { new: true }
    );
    if (!response)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient")
      );
    return sendSuccess(
      res,
      response,
      responseMessage.deleteDataSuccess("patient")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to delete patient"),
      error?.message
    );
  }
};

// ================= Get All Patients =================
export const get_all_patients = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const {
      page,
      limit,
      search,
      sortBy,
      order,
      paymentStatus,
      bloodGroup,
      medicalStoreId,
      isActive,
      all,
    } = req.query;

    const isAll = String(all || "").toLowerCase() === "true";
    const pageNo = isAll ? 1 : parseInt(page as string) || 1;
    const limitNo = isAll ? 0 : parseInt(limit as string) || 10;
    const query: any = { isDeleted: false };

    applyMedicalStoreScope(req, query);

    if (medicalStoreId && req.user.role === ROLES.admin) {
      query.medicalStoreId = medicalStoreId;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (bloodGroup) {
      query.bloodGroup = bloodGroup;
    }

    if (isActive !== undefined) {
      query.isActive = String(isActive) === "true";
    }

    if (search) {
      const regex = new RegExp(String(search), "i");
      query.$or = [
        { name: regex },
        { contactNumber: regex },
        { disease: regex },
        { notes: regex },
      ];
    }

    const safeSortBy =
      sortBy === "name"
        ? "name"
        : sortBy === "totalDue"
        ? "totalDue"
        : sortBy === "totalPaid"
        ? "totalPaid"
        : "createdAt";

    const options: any = {
      sort: {
        [safeSortBy]: String(order || "desc").toLowerCase() === "asc" ? 1 : -1,
      },
    };

    if (!isAll) {
      options.skip = (pageNo - 1) * limitNo;
      options.limit = limitNo;
    }

    const rawPatients: any = await getData(patientModel, query, {}, options);
    const data = await patientModel.populate(rawPatients, [
      { path: "userId", select: "name email role" },
      { path: "medicalStoreId", select: "name" },
    ]);

    const total = await countData(patientModel, query);
    const resolvedLimit = isAll ? total || 1 : limitNo;
    const totalPages = isAll ? (total > 0 ? 1 : 0) : Math.ceil(total / limitNo);

    return sendSuccess(
      res,
      {
        data,
        patients: data,
        pagination: {
          page: pageNo,
          limit: resolvedLimit,
          total,
          totalPages,
        },
      },
      responseMessage.getDataSuccess("patients")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to fetch patients"),
      error?.message
    );
  }
};

// ================= Get Patient By Id =================
export const get_patient_by_id = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(
        res,
        status_code.BAD_REQUEST,
        responseMessage.invalidId("patient id")
      );

    const query: any = { _id: id, isDeleted: false };
    applyMedicalStoreScope(req, query);

    const response: any = await findOneAndPopulate(
      patientModel,
      query,
      {},
      {},
      [
        { path: "userId", select: "name email role" },
        { path: "medicalStoreId", select: "name" },
      ]
    );

    if (!response)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient")
      );

    const patientObj = response?.toObject ? response.toObject() : response;

    return sendSuccess(
      res,
      {
        patient: patientObj,
        data: patientObj,
        payments: patientObj?.paymentHistory || [],
      },
      responseMessage.getDataSuccess("patient")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to fetch patient"),
      error?.message
    );
  }
};

// ================= Toggle Patient Active Status =================
export const toggle_patient_active_status = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { id } = req.params;
    const { error, value } = patientValidation.togglePatientStatusValidation.validate(
      req.body,
      commonValidation.joiValidationOptions
    );
    if (error)
      return sendError(res, status_code.BAD_REQUEST, error.details[0].message);
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(
        res,
        status_code.BAD_REQUEST,
        responseMessage.invalidId("patient id")
      );

    const query: any = { _id: id, isDeleted: false };
    applyMedicalStoreScope(req, query);

    const response = await updateData(
      patientModel,
      query,
      { isActive: value.isActive },
      { new: true }
    );
    if (!response)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient")
      );

    return sendSuccess(
      res,
      response,
      value.isActive
        ? responseMessage.customMessage("patient activated successfully")
        : responseMessage.customMessage("patient deactivated successfully")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.updateDataError("patient status"),
      error?.message
    );
  }
};

// ================= Add Patient Payment =================
export const add_patient_payment = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { error, value } = patientValidation.addPatientPaymentValidation.validate(
      req.body,
      commonValidation.joiValidationOptions
    );
    if (error)
      return sendError(res, status_code.BAD_REQUEST, error.details[0].message);

    const query: any = { _id: value.patientId, isDeleted: false };
    applyMedicalStoreScope(req, query);

    const patient: any = await getFirstMatch(patientModel, query);
    if (!patient)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient")
      );

    const newPayment = {
      _id: new mongoose.Types.ObjectId(),
      amount: Number(value.amount),
      type: value.type,
      date: value.date ? new Date(value.date) : new Date(),
      paymentMethod: value.paymentMethod || "Cash",
      notes: value.notes || "",
      createdAt: new Date(),
    };

    const updatedHistory = [...(patient.paymentHistory || []), newPayment];
    const { totalDue, totalPaid, paymentStatus } =
      calculatePatientPaymentTotals(updatedHistory);

    const response = await updateData(
      patientModel,
      query,
      {
        paymentHistory: updatedHistory,
        totalDue,
        totalPaid,
        paymentStatus,
      },
      { new: true }
    );

    const result = response?.toObject ? response.toObject() : response;

    return sendSuccess(
      res,
      {
        patient: result,
        data: result,
        payment: newPayment,
      },
      responseMessage.customMessage("payment added successfully")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to add patient payment"),
      error?.message
    );
  }
};

// ================= Delete Patient Payment =================
export const delete_patient_payment = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return sendError(
        res,
        status_code.BAD_REQUEST,
        responseMessage.invalidId("payment id")
      );

    const query: any = {
      "paymentHistory._id": id,
      isDeleted: false,
    };
    applyMedicalStoreScope(req, query);

    const patient: any = await getFirstMatch(patientModel, query);
    if (!patient)
      return sendError(
        res,
        status_code.NOT_FOUND,
        responseMessage.getDataNotFound("patient payment record")
      );

    const updatedHistory = (patient.paymentHistory || []).filter(
      (p: any) => String(p._id) !== String(id)
    );

    const { totalDue, totalPaid, paymentStatus } =
      calculatePatientPaymentTotals(updatedHistory);

    const response = await updateData(
      patientModel,
      { _id: patient._id },
      {
        paymentHistory: updatedHistory,
        totalDue,
        totalPaid,
        paymentStatus,
      },
      { new: true }
    );

    const result = response?.toObject ? response.toObject() : response;

    return sendSuccess(
      res,
      {
        patient: result,
        data: result,
      },
      responseMessage.customMessage("payment record deleted successfully")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to delete payment record"),
      error?.message
    );
  }
};

// ================= Get Patient Reports =================
export const get_patient_reports = async (req: any, res: any) => {
  reqInfo(req);
  try {
    const { startDate, endDate, medicalStoreId, addedBy } = req.query;
    const query: any = { isDeleted: false };

    applyMedicalStoreScope(req, query);

    if (medicalStoreId && req.user.role === ROLES.admin) {
      query.medicalStoreId = medicalStoreId;
    }
    if (addedBy && req.user.role === ROLES.admin) {
      query.userId = addedBy;
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.$gte = startOfDay(new Date(startDate as string));
      if (endDate) dateFilter.$lte = endOfDay(new Date(endDate as string));
      query.createdAt = dateFilter;
    }

    const rawPatients: any = await getData(patientModel, query);
    const patients: any = await patientModel.populate(rawPatients, [
      { path: "userId", select: "name email role" },
      { path: "medicalStoreId", select: "name" },
    ]);

    let totalDue = 0;
    let totalPaid = 0;
    let dueCount = 0;
    let paidCount = 0;

    (patients || []).forEach((patient: any) => {
      totalDue += Number(patient.totalDue) || 0;
      totalPaid += Number(patient.totalPaid) || 0;
      if (patient.paymentStatus === "Paid") {
        paidCount++;
      } else {
        dueCount++;
      }
    });

    const reportSummary = {
      totalPatients: (patients || []).length,
      totalDue,
      totalPaid,
      duePatientsCount: dueCount,
      paidPatientsCount: paidCount,
    };

    return sendSuccess(
      res,
      {
        summary: reportSummary,
        patients,
        data: {
          summary: reportSummary,
          patients,
        },
      },
      responseMessage.getDataSuccess("patient reports")
    );
  } catch (error: any) {
    return sendError(
      res,
      status_code.BAD_REQUEST,
      responseMessage.customMessage("failed to generate patient report"),
      error?.message
    );
  }
};
