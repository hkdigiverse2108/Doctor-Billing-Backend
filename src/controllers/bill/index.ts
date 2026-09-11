import { userModel, billModel, productModel, storeModel } from "../../database";
import { responseMessage, ROLES, status_code, TAX_TYPE, BILL_STATUS, PAYMENT_METHOD } from "../../common";
import mongoose from "mongoose";
import { billValidation, commonValidation } from "../../validation";
import { billQueryByRole, buildBillPayload, canAccessMedicalStore, countData, endOfDay, getData, getFirstMatch, reqInfo, resolveQuickDateRange, sendError, sendSuccess, startOfDay, updateData } from "../../helper";

// ================== ADD BILL ==================
export const add_bill = async (req, res) => {
  reqInfo(req)
  try {
    const { error, value } = billValidation.addBillValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)

    const { userId, items, discount = 0, billNumber } = value
    const gstEnabled = value.gstEnabled !== false;
    const selectedCompany = value.company || undefined;
    let billUserId: any = req.user._id;
    let medicalStoreId: any = req.user?.medicalStoreId;

    // Admin user validation
    if (req.user.role === "admin") {
      if (!userId) return sendError(res, status_code.BAD_REQUEST, "Please select user");
      const owner: any = await userModel.findOne(
        { _id: String(userId), isDeleted: false, role: { $ne: ROLES.admin } },
        { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 }
      );

      if (!owner) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"));
      billUserId = owner._id;
      medicalStoreId =
        owner.medicalStoreId ||
        (Array.isArray(owner.medicalStoreIds)
          ? owner.medicalStoreIds[0]?._id || owner.medicalStoreIds[0]
          : null);

      const selectedUserStoreId = String(medicalStoreId?._id || medicalStoreId || "").trim();
      if (!selectedUserStoreId || !mongoose.Types.ObjectId.isValid(selectedUserStoreId)) {
        return sendError(res, status_code.BAD_REQUEST, "Selected user has no medical store assigned");
      }
    }

    const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim();
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return sendError(res, status_code.BAD_REQUEST, "Medical store is not assigned to current user");
    }
    if (req.user.role !== "admin" && !canAccessMedicalStore(req, storeId)) {
      return sendError(res, status_code.FORBIDDEN, responseMessage.customMessage("not authorized for selected medical store"));
    }

    const store: any = await getFirstMatch(storeModel, { _id: storeId, isDeleted: false }, { taxType: 1, taxPercent: 1 });
    if (!store) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("medical store"));
    const taxType = String(store.taxType || TAX_TYPE.SGST_CGST);
    const taxPercent = gstEnabled ? Math.max(Number(store.taxPercent) || 0, 0) : 0;

    let srNo = 1;
    let subTotal = 0;
    let totalGST = 0;
    const processedItems = [];

    // Process each item
    for (let item of items) {
      const product: any = await productModel.findOne({
        _id: item.product,
        isDeleted: false,
        ...(storeId ? { medicalStoreId: storeId } : {}),
      });

      if (!product) return sendError(res, status_code.NOT_FOUND, `Product not found: ${item.product}`);
      if (!product.isActive) return sendError(res, status_code.BAD_REQUEST, `${product.name} is inactive`);

      const qty = Number(item.qty) || 0;
      const freeQty = Math.max(Number(item.freeQty) || 0, 0);


      const mrp = Number(item.mrp) || 0;
      const rate = Number(item.rate) || 0;

      const total = rate * qty;
      const gstAmount = (total * taxPercent) / 100;
      const sgst = taxType === TAX_TYPE.SGST_CGST ? gstAmount / 2 : 0;
      const cgst = taxType === TAX_TYPE.SGST_CGST ? gstAmount / 2 : 0;
      const igst = taxType === TAX_TYPE.IGST ? gstAmount : 0;

      processedItems.push({
        srNo: srNo++,
        product: product._id,
        name: product.name,
        category: product.category,
        qty,
        freeQty,
        mrp,
        rate,
        expiry: product.expiry || "",
        gstAmount,
        total,
        sgst,
        cgst,
        igst,
        company: selectedCompany,
      });

      subTotal += total;
      totalGST += gstAmount;
    }

    const discountedSubTotal = Math.max(subTotal - discount, 0);
    totalGST = (discountedSubTotal * taxPercent) / 100;
    const grandTotal = discountedSubTotal + totalGST;
    const billStatus = value.paymentMethod === PAYMENT_METHOD.cash ? BILL_STATUS.paid : BILL_STATUS.due;

    let response: any;
    try {
      response = await billModel.create(
        buildBillPayload(value, {
          billNumber,
          userId: billUserId,
          medicalStoreId: storeId,
          items: processedItems,
          subTotal,
          totalGST,
          discount,
          grandTotal,
          billStatus,
          isActive: true,
        })
      );
    } catch (err: any) {
      const isDuplicateKeyError =
        err &&
        (err.code === 11000 || err.name === "MongoServerError") &&
        String(err.message || "").includes("billNumber");
      if (isDuplicateKeyError) {
        return sendError(res, status_code.BAD_REQUEST, "Bill number already exists for this medical store");
      }
      throw err;
    }

    return sendSuccess(res, response, responseMessage.addDataSuccess("bill"));
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to add bill"), err);
  }
};

// ================== UPDATE BILL ==================
export const update_bill_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = billValidation.updateBillValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("bill id"))

    const existingBill = await getFirstMatch(billModel, billQueryByRole(req, id))
    if (!existingBill) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("bill"))

    const { userId, items, discount = 0, billNumber } = value;
    const gstEnabled = value.gstEnabled !== false;
    const selectedCompany = value.company || undefined;
    let billUserId: any = req.user._id;
    let medicalStoreId: any = req.user?.medicalStoreId;

    if (req.user.role === "admin") {
      if (!userId) return sendError(res, status_code.BAD_REQUEST, "Please select user");
      const owner: any = await getFirstMatch(
        userModel,
        { _id: String(userId), isDeleted: false, role: { $ne: ROLES.admin } },
        { _id: 1, medicalStoreId: 1, medicalStoreIds: 1 }
      );
      if (!owner) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("selected user"));
      billUserId = owner._id;
      medicalStoreId =
        owner.medicalStoreId ||
        (Array.isArray(owner.medicalStoreIds)
          ? owner.medicalStoreIds[0]?._id || owner.medicalStoreIds[0]
          : null);

      const selectedUserStoreId = String(medicalStoreId?._id || medicalStoreId || "").trim();
      if (!selectedUserStoreId || !mongoose.Types.ObjectId.isValid(selectedUserStoreId)) {
        return sendError(res, status_code.BAD_REQUEST, "Selected user has no medical store assigned");
      }
    }

    const storeId = String(medicalStoreId?._id || medicalStoreId || "").trim();
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return sendError(res, status_code.BAD_REQUEST, "Medical store is not assigned to current user");
    }
    if (req.user.role !== "admin" && !canAccessMedicalStore(req, storeId)) {
      return sendError(res, status_code.FORBIDDEN, responseMessage.customMessage("not authorized for selected medical store"));
    }

    const store: any = await getFirstMatch(storeModel, { _id: storeId, isDeleted: false }, { taxType: 1, taxPercent: 1 });
    if (!store) return sendError(res, status_code.BAD_REQUEST, responseMessage.getDataNotFound("medical store"));
    const taxType = String(store.taxType || TAX_TYPE.SGST_CGST);
    const taxPercent = gstEnabled ? Math.max(Number(store.taxPercent) || 0, 0) : 0;

    const productIds = Array.from(
      new Set(
        (items || [])
          .map((item) => String(item.product || ""))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      )
    );

    const products: any[] = await productModel.find({
      _id: { $in: productIds },
      isDeleted: false,
      ...(storeId ? { medicalStoreId: storeId } : {}),
    });

    const productsById = new Map<string, any>();
    for (const product of products) {
      productsById.set(String(product._id), product);
    }

    let srNo = 1;
    let subTotal = 0;
    let totalGST = 0;
    const processedItems = [];

    for (const item of items) {
      const product = productsById.get(String(item.product || ""));

      if (!product) return sendError(res, status_code.NOT_FOUND, `Product not found: ${item.product}`);
      if (!product.isActive) return sendError(res, status_code.BAD_REQUEST, `${product.name} is inactive`);

      const qty = Number(item.qty) || 0;
      const freeQty = Math.max(Number(item.freeQty) || 0, 0);


      const mrp = Number(item.mrp) || 0;
      const rate = Number(item.rate) || 0;

      const total = rate * qty;
      const gstAmount = (total * taxPercent) / 100;
      const sgst = taxType === TAX_TYPE.SGST_CGST ? gstAmount / 2 : 0;
      const cgst = taxType === TAX_TYPE.SGST_CGST ? gstAmount / 2 : 0;
      const igst = taxType === TAX_TYPE.IGST ? gstAmount : 0;

      processedItems.push({
        srNo: srNo++,
        product: product._id,
        name: product.name,
        category: product.category,
        qty,
        freeQty,
        mrp,
        rate,
        expiry: product.expiry || "",
        gstAmount,
        total,
        sgst,
        cgst,
        igst,
        company: selectedCompany,
      });

      subTotal += total;
      totalGST += gstAmount;
    }

    const discountedSubTotal = Math.max(subTotal - discount, 0);
    totalGST = (discountedSubTotal * taxPercent) / 100;
    const grandTotal = discountedSubTotal + totalGST;
    const billStatus = value.paymentMethod === PAYMENT_METHOD.cash ? BILL_STATUS.paid : BILL_STATUS.due;

    let response: any;
    try {
      response = await updateData(
        billModel,
        billQueryByRole(req, id),
        buildBillPayload(value, {
          billNumber,
          userId: billUserId,
          medicalStoreId: storeId,
          items: processedItems,
          subTotal,
          totalGST,
          discount,
          grandTotal,
          billStatus,
        }),
        { new: true }
      );
    } catch (err: any) {
      const isDuplicateKeyError =
        err &&
        (err.code === 11000 || err.name === "MongoServerError") &&
        String(err.message || "").includes("billNumber");
      if (isDuplicateKeyError) {
        return sendError(res, status_code.BAD_REQUEST, "Bill number already exists for this medical store");
      }
      throw err;
    }

    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("bill"));

    return sendSuccess(res, response, responseMessage.updateDataSuccess("bill"));
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, err?.message || responseMessage.updateDataError("bill"), err);
  }
};


// ================== DELETE BILL ==================
export const delete_bill_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("bill id"))

    const response = await updateData(billModel, billQueryByRole(req, id), { isDeleted: true }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("bill"))

    return sendSuccess(res, response, responseMessage.deleteDataSuccess("bill"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to delete bill"), err)
  }
};

// ================== GET ALL BILLS ==================
export const get_all_bill = async (req, res) => {
  reqInfo(req)
  try {
    const { page, limit, search, fromDate, toDate, quickDate, isActive, companyId, billStatus } = req.query
    const pageNo = parseInt(page as string) || 1
    const limitNo = parseInt(limit as string) || 10
    const query: any = billQueryByRole(req)

    if (search) query.billNumber = new RegExp(String(search).trim(), "i")
    if (isActive !== undefined) query.isActive = String(isActive) === "true"
    if (companyId) {
      const companyIdStr = String(companyId || "").trim();
      if (!mongoose.Types.ObjectId.isValid(companyIdStr)) {
        return sendError(res, status_code.BAD_REQUEST, "Invalid company id");
      }
      query["items.company"] = companyIdStr;
    }
    if (billStatus) {
      const statusValue = String(billStatus || "").trim();
      if (!Object.values(BILL_STATUS).includes(statusValue)) {
        return sendError(res, status_code.BAD_REQUEST, "Invalid bill status");
      }
      query.billStatus = statusValue;
    }

    const range = resolveQuickDateRange(quickDate?.toString().trim().toLowerCase())
    if (range) {
      query.purchaseDate = { $gte: range.from, $lte: range.to }
    } else if (fromDate || toDate) {
      const filter: any = {}
      if (fromDate) filter.$gte = startOfDay(new Date(fromDate as string))
      if (toDate) filter.$lte = endOfDay(new Date(toDate as string))
      if (filter.$gte && filter.$lte && filter.$gte > filter.$lte) {
        return sendError(res, status_code.BAD_REQUEST, "fromDate cannot be greater than toDate")
      }
      query.purchaseDate = filter
    }

    const total = await countData(billModel, query)
    const billsRaw: any = await getData(billModel, query, {}, { sort: { purchaseDate: -1, createdAt: -1 }, skip: (pageNo - 1) * limitNo, limit: limitNo })

    const bills = await billModel.populate(billsRaw, [
      { path: "userId", select: "name medicalName email phone address city state pincode pan gstin signatureImg" },
      { path: "medicalStoreId", select: "name address pincode state panNumber gstNumber signatureImg" },
      { path: "items.product", select: "name category expiry mrp sellingPrice" },
      { path: "items.company", select: "name gstNumber phone email address city state pincode logoImage" },
    ])

    return sendSuccess(res, {
      bills,
      pagination: {
        page: pageNo,
        limit: limitNo,
        total,
        totalPages: Math.ceil(total / limitNo)
      },
    }, responseMessage.getDataSuccess("bills"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, err?.message || responseMessage.customMessage("failed to fetch bills"), err)
  }
};

// ================== GET BILL BY ID ==================
export const get_bill_by_id = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("bill id"))

    const response = await billModel
      .findOne(billQueryByRole(req, id))
      .populate("userId", "name medicalName email phone address city state pincode pan gstin signatureImg")
      .populate("medicalStoreId", "name address pincode state panNumber gstNumber signatureImg")
      .populate("items.product", "name category expiry mrp sellingPrice")
      .populate("items.company", "name gstNumber phone email address city state pincode logoImage")

    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("bill"))
    return sendSuccess(res, response, responseMessage.getDataSuccess("bill"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.customMessage("failed to fetch bill"), err)
  }
};

// ================== TOGGLE BILL ACTIVE STATUS ==================
export const toggle_bill_active_status = async (req, res) => {
  reqInfo(req)
  try {
    const { id } = req.params
    const { error, value } = billValidation.toggleBillStatusValidation.validate(req.body, commonValidation.joiValidationOptions)
    if (error) return sendError(res, status_code.BAD_REQUEST, error.details[0].message)
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, status_code.BAD_REQUEST, responseMessage.invalidId("bill id"))

    const response = await updateData(billModel, billQueryByRole(req, id), { isActive: value.isActive }, { new: true })
    if (!response) return sendError(res, status_code.NOT_FOUND, responseMessage.getDataNotFound("bill"))
    return sendSuccess(res, response, value.isActive ? responseMessage.customMessage("bill activated successfully") : responseMessage.customMessage("bill deactivated successfully"))
  } catch (err) {
    return sendError(res, status_code.BAD_REQUEST, responseMessage.updateDataError("bill status"), err)
  }
};
