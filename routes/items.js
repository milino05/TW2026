const express = require("express");
const router = express.Router();
const Item = require("../models/items");
const Config = require("../models/config");

router.post("/items", async (req, res) => {
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
        if (riferimenti.bidirezionale) {
          await Item.findByIdAndUpdate(refId, { $addToSet: { riferimenti: item._id } });
        }
      }
      await item.save();
    }

    res.json({ success: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

module.exports = router;