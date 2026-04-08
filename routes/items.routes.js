const express = require("express");
const router = express.Router();
const Item = require("../models/item");
const Config = require("../models/config");


const {
  createItem,
  updateItem,
  getEditorVocabulary,
} = require("../controllers/items.controller");



router.get("/museums/:museumId/editor-vocabulary", getEditorVocabulary);
router.post("/museums/:museumId/items", createItem);
router.put("/museums/:museumId/items/:itemId", updateItem);


//GET ALL
router.get("/", async (req, res) => {
  try {
    const items = await Item.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "Errore server" });
  }
});

//GET ONE
router.get("/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ error: "Item non trovato" });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: "Errore server" });
  }
});

//UPDATE ONE
router.put("/:id", async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ error: "Item non trovato" });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: "Errore server" });
  }
});

//DELETE ONE
router.delete("/:id", async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({ error: "Item non trovato" });
    }

    res.json({ message: "Item eliminato" });
  } catch (err) {
    res.status(500).json({ error: "Errore server" });
  }
});



module.exports = router;
