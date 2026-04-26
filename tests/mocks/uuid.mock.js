// tests/mocks/uuid.mock.js
// Mock for the uuid package used in ai.service.js

const mockUuid = '123e4567-e89b-12d3-a456-426614174000';

module.exports = {
  v4: jest.fn(() => mockUuid),
  v1: jest.fn(() => mockUuid),
  v3: jest.fn(() => mockUuid),
  v5: jest.fn(() => mockUuid),
  validate: jest.fn(() => true),
  version: jest.fn(() => 4)
};
