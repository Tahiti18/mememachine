// index.js

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const dotenv = require('dotenv');
dotenv.config();

const { startMonitoring } = require('./services/twitterMonitor');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes (example: health check)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Start Twitter monitoring automatically
startMonitoring();

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
