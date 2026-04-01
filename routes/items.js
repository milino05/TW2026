const express = require("express");
const router = express.Router();
const Item = require("../models/item");
const Config = require("../models/config");

router.post("/", async (req, res) => {
  try {
    const { codice, nome, contenuti, riferimenti, bidirezionale } = req.body;
    const museoId = req.museoId; // supponiamo che tu abbia l'id del museo dal login

    // 1. Prendi le categorie del museo
    const config = await Config.findOne({ museoId });
    if (!config) return res.status(400).json({ error: "Config museo non trovata" });

    // 2. Validazione contenuti
    for (const c of contenuti) {
      if (!config.linguaggi.includes(c.linguaggio)) {
        return res.status(400).json({ error: `Linguaggio non valido: ${c.linguaggio}` });
      }
      if (!config.lunghezze.includes(c.lunghezza)) {
        return res.status(400).json({ error: `Lunghezza non valida: ${c.lunghezza}` });
      }
    }

    // 3. Crea l'item
    const item = new Item({ codice, nome, contenuti, riferimenti: [] });
    await item.save();

    // 4. Aggiungi riferimenti e gestisci bidirezionale
    if (riferimenti && riferimenti.length > 0) {
      for (const refId of riferimenti) {
        // aggiungi riferimento all'item
        item.riferimenti.push(refId);

        // se bidirezionale, aggiorna l'altro item
        if (bidirezionale) {
          await Item.findByIdAndUpdate(refId, { $addToSet: { riferimenti: item._id } });
        }
      }
      await item.save();
    }

    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



router.post("/breve", async (req, res) => {
  try {
    const item = new Item(req.body);
    await item.save();
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



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
