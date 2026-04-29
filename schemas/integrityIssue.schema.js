const IntegrityIssueSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
    },

    field: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },
    context: {
      type: Schema.Types.Mixed,
    },
  },
  { _id: false },
);
