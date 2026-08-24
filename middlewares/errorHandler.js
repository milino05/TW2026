function mongooseValidationDetails(err) {
  return Object.values(err.errors || {}).map((validationError) => ({
    field: validationError.path,
    code: "MONGOOSE_VALIDATION_ERROR",
    message: validationError.message,
  }));
}

function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || "Errore interno del server";
  let details = err.details || null;

  if (err.name === "ValidationError") {
    status = 400;
    message = "Payload non valido";
    details = mongooseValidationDetails(err);
  }

  if (err.name === "CastError") {
    status = 400;
    message = "Identificatore non valido";
    details = [
      {
        field: err.path,
        code: "INVALID_VALUE",
        message: `${err.path} non contiene un valore valido`,
      },
    ];
  }

  if (err.code === 11000) {
    status = 409;
    message = "Valore gia esistente";
    details = Object.keys(err.keyPattern || {}).map((field) => ({
      field,
      code: "DUPLICATE_VALUE",
      message: `${field} deve essere univoco`,
    }));
  }

  if (status >= 500 && !err.status) {
    console.error(err);
    message = "Errore interno del server";
    details = null;
  }

  const retryAfterSeconds = Array.isArray(details)
    ? details.find((detail) => detail?.code === "PROVIDER_UNAVAILABLE")?.retryAfterSeconds
    : null;
  if (retryAfterSeconds !== null && retryAfterSeconds !== undefined
    && Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) >= 0) {
    res.set("Retry-After", String(Math.ceil(Number(retryAfterSeconds))));
  }

  res.status(status).json({
    message,
    errors: details,
  });
}

module.exports = errorHandler;
