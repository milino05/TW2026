function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  res.status(status).json({
    message: err.message || "Errore interno del server",
    errors: err.details || null,
  });
}

module.exports = errorHandler;
