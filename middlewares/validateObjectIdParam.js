const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

function validateObjectIdParam(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];

    if (!mongoose.Types.ObjectId.isValid(value)) {
      return next(
        new AppError("Parametro non valido", 400, [
          {
            field: paramName,
            code: "INVALID_OBJECT_ID",
            message: `${paramName} non è un ObjectId valido`,
          },
        ]),
      );
    }

    next();
  };
}

module.exports = { validateObjectIdParam };
