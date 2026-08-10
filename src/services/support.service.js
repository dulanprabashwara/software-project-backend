const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createSupportRequest = async (data) => {
  return await prisma.supportRequest.create({
    data,
  });
};

module.exports = {
  createSupportRequest,
};
