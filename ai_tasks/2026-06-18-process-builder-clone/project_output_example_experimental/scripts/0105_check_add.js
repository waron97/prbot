try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('cartResponse'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var prodvid;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code == 200) {
        var body = JSON.parse(jsonResponse.body);
        prodvid = body.cart[0].vid;
    } else {
        throw new Error('Add to cart returned non-200 response');
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('prodvid', prodvid);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
    execution.setVariable('errorCode', 'GET_CART_FAIL');
}
