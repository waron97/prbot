try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var products = JSON.parse(execution.getVariable('products'));
    var selectedProduct = execution.getVariable('selectedProduct');
    var selectedPricelist = execution.getVariable('selectedPriceList');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var setAttributesBody;
    var productClientType; // "RES" | "BUS"
    var productOfferType; // "Standard" | "Non_Standard"

    // ----------------------------
    // Logical Helpers
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

    var product = arrayFind(products, function (product) {
        return product._id === selectedProduct;
    });

    if (!product) {
        throw new Error('Could not find product information.');
    }

    var listinoFamily = arrayFind(product.families, function (family) {
        return (
            family.name === 'LISTINO' ||
            family.name === 'LISTINO Dynamic Lookup'
        );
    });

    if (!listinoFamily) {
        throw new Error('LISTINO family not found');
    }

    var listinoAttribute =
        listinoFamily.attributes.length === 1
            ? listinoFamily.attributes[0]
            : arrayFind(listinoFamily.attributes, function (attribute) {
                  // Safely handle undefined names, trim whitespace, and convert to lowercase
                  var attrName = (attribute.name || '').trim().toLowerCase();
                  return (
                      attrName === 'listino' ||
                      attrName === 'listino dynamic lookup'
                  );
              });

    if (!listinoAttribute) {
        throw new Error('LISTINO attribute not found');
    }

    setAttributesBody = {
        attributes: [
            {
                pfid: listinoFamily._id,
                attrid: listinoAttribute._id,
                value: selectedPricelist,
            },
        ],
    };

    productOfferType = product.tipo_offerta || null;
    productClientType = product.tipo_cliente || null;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable(
        'setAttributesBody',
        JSON.stringify(setAttributesBody)
    );
    execution.setVariable('productClientType', productClientType);
    execution.setVariable('productOfferType', productOfferType);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'err_prep_attributes');
    execution.setVariable('errorMessage', err.message);
}
