// tests/idGenerator.test.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { generateId } = require('../src/utils/idGenerator');
const IdCounter = require('../src/models/IdCounter');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    await IdCounter.deleteMany({});
});

describe('ID Generator Utility', () => {
    test('generates standardized format: <PREFIX><YYYY><MM><DD><4-digit serial>', async () => {
        const testDate = new Date(2026, 8, 26); // September 26, 2026
        const id1 = await generateId('DSP', testDate);
        const id2 = await generateId('DSP', testDate);
        const id3 = await generateId('HLD', testDate);

        expect(id1).toBe('DSP202609260001');
        expect(id2).toBe('DSP202609260002');
        expect(id3).toBe('HLD202609260001');
    });

    test('throws error if prefix is not 3 characters', async () => {
        await expect(generateId('DS')).rejects.toThrow('Prefix must be exactly 3 characters');
        await expect(generateId('DISPATCH')).rejects.toThrow('Prefix must be exactly 3 characters');
    });

    test('daily rollover restarts serial counter for a new date', async () => {
        const day1 = new Date(2026, 8, 26);
        const day2 = new Date(2026, 8, 27);

        const idDay1 = await generateId('REJ', day1);
        const idDay2 = await generateId('REJ', day2);

        expect(idDay1).toBe('REJ202609260001');
        expect(idDay2).toBe('REJ202609270001');
    });
});
