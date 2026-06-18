try{ 
	var jsonResponse = JSON.parse(execution.getVariable('saveDataResponse'));
	if(jsonResponse.code != 200){		
		execution.setVariable("isAlive",false);
		execution.setVariable('errorCode','SAVE_DATA_FAIL');
	}
	
}catch(err){ 
	execution.setVariable("isAlive",false);
	execution.setVariable('errorCode','SAVE_DATA_GENERIC_FAIL');
	execution.setVariable('errorMessage',err.message); 
}
