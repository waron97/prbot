try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var catalog_guid = execution.getVariable('catalog_guid');
    var pricelist_guid = execution.getVariable('pricelist_guid');

    var asset = JSON.parse(execution.getVariable('outgoingAsset'));

    var productOptions = JSON.parse(execution.getVariable('productOptions'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var getOutgoingPricelistUrl =
        'http://b2w-cpq-pricelists-manager-service/v1/get_pricelists_data';
    var getOutgoingPricelistBody;

    var updatedProductOptions = productOptions;
    var selectedProduct = null;
    var searchListinoError = null;

    // ----------------------------
    // Helpers
    // ----------------------------

    function arraySome(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return true;
            }
        }
        return false;
    }

    function arrayFind(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return arr[i];
            }
        }
        return undefined;
    }

    // ----------------------------

    function getListinoFromAsset(asset) {
        var families = asset.families;

        if (!families) {
            throw new Error('[getListinoFromAsset] asset has no families');
        }

        var family;

        if (families.length === 1) {
            family = families[0];
        } else {
            family = arrayFind(families, function (f) {
                var name = f.name.toLowerCase();
                return name === 'listino' || name === 'listino dynamic lookup';
            });
        }

        if (!family || !family.attributes || family.attributes.length === 0) {
            throw new Error('[getListinoFromAsset] listino family not found');
        }

        var attribute;

        if (family.attributes.length === 1) {
            attribute = family.attributes[0];
        } else {
            attribute = arrayFind(
                family.attributes(function (a) {
                    var name = a.name.toLowerCase();
                    return (
                        name === 'listino' || name === 'listino dynamic lookup'
                    );
                })
            );
        }

        if (!attribute || !attribute.value) {
            throw new Error(
                '[getListinoFromAsset] listino attribute not found or it has no value'
            );
        }

        return attribute.value;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    var listino;

    try {
        listino = getListinoFromAsset(asset);
    } catch (err) {
        listino = null;
        searchListinoError = err.message;
    }

    if (!asset.prodname || !asset.prodid || !listino) {
        throw new Error('Required data not present on asset');
    }

    selectedProduct = asset.prodid;

    var isProductInOptions = arraySome(productOptions, function (option) {
        return option.value === asset.prodid;
    });

    if (!isProductInOptions) {
        updatedProductOptions.push({
            text: asset.prodname,
            value: asset.prodid,
        });
    }

    getOutgoingPricelistBody = {
        catalog_guid: catalog_guid,
        pricelist_guid: pricelist_guid,
        size: 1000000,
        page: 1,
        group_to_show: 'all',
        filters: [
            {
                $and: [
                    { pricelist_code: listino },
                    { product_id: asset.prodid },
                ],
            },
        ],
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('getOutgoingPricelistUrl', getOutgoingPricelistUrl);
    execution.setVariable(
        'getOutgoingPricelistBody',
        JSON.stringify(getOutgoingPricelistBody)
    );
    execution.setVariable('selectedProduct', selectedProduct);
    execution.setVariable(
        'productOptions',
        JSON.stringify(updatedProductOptions)
    );
    execution.setVariable('mortisCausaError', false);
    execution.setVariable('searchListinoError', searchListinoError);
} catch (err) {
    execution.setVariable('mortisCausaError', true);
    execution.setVariable('mortisCausaErrorCode', 'ERR_PREP_MORTIS_CAUSA');
    execution.setVariable('mortisCausaErrorMessage', err.message);
    execution.setVariable('mortis_asset_load_fail', true);
}
