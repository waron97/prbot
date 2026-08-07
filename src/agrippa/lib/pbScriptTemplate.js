// Initial body scaffolded into a new scriptTask's .js file (mirrors the
// `pbtemplate` editor snippet) so created scripts aren't empty.
export const SCRIPT_TEMPLATE = `try {
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
    execution.setVariable('errorCode', '0');
    execution.setVariable('errorMessage', err.message);
}
`;
