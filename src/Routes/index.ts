import express from "express";
import { verifyToken } from "../middleware";
import { companyRouter } from "./company";
import { productRouter } from "./product";
import { CatergoryRouter } from "./category";
import { billRouter } from "./bill";
import { accountRoute } from "./account";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { medicalStoreRouter } from "./medicalStore";
import { dashboardRouter } from "./dashboard";
import { financialRouter } from "./financial";
import { patientRouter } from "./patient";

const router = express.Router();

router.use("/auth", authRouter);

router.use(verifyToken);
router.use("/account", accountRoute);
router.use("/company", companyRouter);
router.use("/user", userRouter);
router.use("/product", productRouter);
router.use("/bill", billRouter);
router.use("/category", CatergoryRouter);
router.use("/medical-store", medicalStoreRouter);
router.use("/dashboard", dashboardRouter);
router.use("/financial", financialRouter);
router.use("/patient", patientRouter);

export { router };
