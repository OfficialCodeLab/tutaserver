var ssa = {};
ssa.mobile = {};

ssa.mobile.odata = function(url,user,password) {
  this.url = url;
  this.user = user;
  this.password = password;
  
  // TODO call service to get $metadata
}

ssa.mobile.odata.prototype.read = function(collection,success,error) {
	$.ajax({
			type: "GET",
			url: this.url + collection,
			contentType: "application/json; charset=utf-8",
			dataType: "json",
			success: function(msg) {    
				success(msg);
			},
			error: function(e){
				debugger;
				error(e);            
			}
		});
}

ssa.mobile.odata.prototype.create = function(collection,data,success,error) {
	$.ajax({
			type: "POST",
			url: this.url + collection,
			contentType: "application/json; charset=utf-8",
			data: data,
			dataType: "json",
			success: function(msg) {    
				success(msg);
			},
			error: function(e){
				debugger;
				error(e);            
			}
		});
}

ssa.mobile.odata.prototype.update = function(collection,data,success,error) {
	$.ajax({
			type: "PATCH",
			url: this.url + collection,
			contentType: "application/json; charset=utf-8",
			data: data,
			dataType: "json",
			success: function(msg) {   
				success(msg);
			},
			error: function(e){
				debugger;
				error(e);            
			}
		});
}