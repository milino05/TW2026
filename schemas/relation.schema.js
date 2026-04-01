/**
 * Relazione generica tra item.
 * Esempi:
 * - created_by
 * - has_style
 * - depicts
 * - located_in
 * - same_period_as
 * - related_to
 */
const RelationSchema = new Schema(
  {
    /**
     * Chiave del tipo di relazione.
     * Deve puntare a un relation type noto, ad esempio:
     * - "created_by"
     * - "has_style"
     * - "located_in"
     */
    relationType: {
      type: Schema.Types.ObjectId,
      ref: "RelationType",
      required: true
    },


    /**
     * Item di destinazione della relazione.
     * È il nodo target del grafo.
     */
    target: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true
    },

    label: {
      type: String,
      trim: true
    },


     /**
     * Peso opzionale della relazione.
     * Può servire per:
     * - ranking
     * - generazione visite
     * - distinguere legami forti o secondari tra due item specifici
     *
     * Nota:
     * è diverso da "strength" del tipo di relazione,
     * che è una proprietà generale del relation type.
     */
    weight: {
      type: Number,
      default: 1,
      min: 0
    }
  },
  { _id: true }
);

module.exports = RelationSchema;