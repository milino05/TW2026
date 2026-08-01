const express = require("express");

const { register, login, logout, me } = require("../controllers/auth.controller");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.post("/auth/register", register);
router.post("/auth/login", login);
router.post("/auth/logout", requireAuth, logout);
router.get("/auth/me", requireAuth, me);

module.exports = router;
