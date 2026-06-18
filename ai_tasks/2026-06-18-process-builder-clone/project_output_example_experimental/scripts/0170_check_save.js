try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('saveResult'));

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Failed to set product listino attribute');
    }

    // ----------------------------
    // Output
    // ----------------------------
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'err_check_save');
    execution.setVariable('errorMessage', err.message);
}
