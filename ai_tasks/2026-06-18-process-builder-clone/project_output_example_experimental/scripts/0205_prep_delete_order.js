try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var order_id = execution.getVariable('order_id');
    var b2wEndpoint = execution.getVariable('b2wEndpoint');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var deleteOrderUrl;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    // ----------------------------
    // Main Execution
    // ----------------------------

    deleteOrderUrl = '{b2wEndpoint}api/ordermanagement/v1/order/{order_id}'
        .replace('{b2wEndpoint}', b2wEndpoint)
        .replace('{order_id}', order_id);

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('deleteOrderUrl', deleteOrderUrl);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_PREP_DELETE_ORDER');
    execution.setVariable('errorMessage', err.message);
}
