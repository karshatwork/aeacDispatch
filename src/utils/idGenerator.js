// src/utils/idGenerator.js
const IdCounter = require('../models/IdCounter');

/**
 * Generate a standardized ID in format: <PREFIX><YYYY><MM><DD><4-digit serial>
 * e.g., DSP202609260001
 * 
 * @param {string} prefix - 3 uppercase characters (e.g. 'DSP', 'HLD', 'REJ', 'AUD')
 * @param {Date} [date] - Optional date, defaults to current date
 * @returns {Promise<string>}
 */
async function generateId(prefix, date = new Date()) {
    if (!prefix || prefix.length !== 3) {
        throw new Error(`Prefix must be exactly 3 characters. Provided: '${prefix}'`);
    }
    const cleanPrefix = prefix.toUpperCase();

    const yyyy = date.getFullYear().toString();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    const counterKey = `${cleanPrefix}_${dateStr}`;

    const counter = await IdCounter.findOneAndUpdate(
        { counterKey },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    const serialStr = String(counter.seq).padStart(4, '0');
    return `${cleanPrefix}${dateStr}${serialStr}`;
}

module.exports = {
    generateId
};
