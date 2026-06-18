try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('getCategoriesResponse'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var tgCategoryId;

    // ----------------------------
    // Logical helpders
    // ----------------------------

    function arrayFind(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return arr[i];
            }
        }
        return undefined;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Get Categories returned non-200 response');
    }

    var body;

    try {
        body = JSON.parse(jsonResponse.body);
    } catch (err) {
        throw new Error('Categories returned non-parsable response: ' + err.message);
    }

    var category = arrayFind(body.catalog.categories, function (category) {
        return category.name.trim().toLowerCase() === 'energia';
    });

    if (!category) {
        throw new Error('Failed to locate TG category.');
    }

    tgCategoryId = category._id;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('tgCategoryId', tgCategoryId);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'err_check_category_tg');
    execution.setVariable('errorMessage', err.message);
}
