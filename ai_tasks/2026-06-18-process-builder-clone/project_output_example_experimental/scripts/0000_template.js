try {
    // ----------------------------
    // Input gathering
    // ----------------------------
    // ----------------------------
    // Output variable initialization
    // ----------------------------
    // ----------------------------
    // Logical Helpers
    // ----------------------------
    // ----------------------------
    // Main Execution
    // ----------------------------
    // ----------------------------
    // Output
    // ----------------------------
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
