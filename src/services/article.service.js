/* src/services/article.service.js */

const core = require("./article/article.core.service");
const feed = require("./article/article.feed.service");
const workflow = require("./article/article.workflow.service");

/*
 Article Service Facade
 
 This file re-exports all functionalities from modular sub-services
 to maintain backward compatibility with controllers and other modules.
 */
module.exports = {
  // Core CRUD
  ...core,

  // Feeds & Lists
  ...feed,

  // Complex Workflows
  ...workflow,
};