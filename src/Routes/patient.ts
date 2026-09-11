import express from "express";
import { patientController } from "../controllers";

const router = express.Router();

router.post("/add", patientController.add_patient);
router.get("/all", patientController.get_all_patients);
router.get("/report", patientController.get_patient_reports);
router.post("/payment/add", patientController.add_patient_payment);
router.delete("/payment/delete/:id", patientController.delete_patient_payment);
router.get("/:id", patientController.get_patient_by_id);
router.put("/:id", patientController.update_patient_by_id);
router.patch("/:id/status", patientController.toggle_patient_active_status);
router.delete("/delete/:id", patientController.delete_patient_by_id);
router.delete("/:id", patientController.delete_patient_by_id);

export const patientRouter = router;
