var http = require('http');
var nodemailer = require("nodemailer");
var smtpTransport = require('nodemailer-smtp-transport');
//var app = require('connect');
var Datastore = require('nedb');
var db = new Datastore( { inMemoryOnly: true });
var dbs = {};

var gcm = require('node-gcm');
var apn = require('apn');

/**
* Services config
**/
var config = {

    "gcm": {
        "apiKey": "AIzaSyDNmFv0lLzWyUnmzQDig4jT0ZixF9HX1Zs"
    },
 
    "apn": {
        "connection": {
            "gateway": "gateway.sandbox.push.apple.com",
            "cert": "\\uStuck\\certificates\\pushcert.pem",
            "key": "\\uStuck\\certificates\\key.pem",
            "passphrase" : "EN1gma45"
        },
        "feedback": {
            "address": "feedback.sandbox.push.apple.com",
            "cert": "\\uStuck\\certificates\\pushcert.pem",
            "key": "\\uStuck\\certificates\\key.pem",
            "passphrase" : "EN1gma45",
            "interval": 43200,
            "batchFeedback": true
        }
    },
    
    "server": {
    	"server" : "http://localhost",
    	"path" : "/ustuck/services",
    	"port" : 8000,
    	"url" : function(options) { 
    		return options.server + ":" + options.port + options.path;
    		}
    },
    
    "smtp" : {
    	service: "Gmail",
    	auth: {
    		user: "ustucktest@gmail.com",
			pass: "ustuck123" 	
		}
	}
};


/**
* Interrupt example that modifies the result of a service call
* @param result The result of a service call	
**/
var userQueryHandler = function(result) {

	for(var i = 0; i < result.length; i++) {
		result[i].password = "*****";
	}
	
	return result;
}

/**
* function import handler to check if a document exists
* @param cfg Server Config
* @param req HTTP request object (parameters are storedin req.query)
* @param res HTTP response object	
**/
var docExistsHandler = function(cfg,req,res) {

}

/*
* Initialise SMTP transport
*/
var SMTPTransport = nodemailer.createTransport(config.smtp);

/**
* function import handler to send email
* @param cfg Server Config
* @param req HTTP request object (parameters are storedin req.query)
* @param res HTTP response object	
**/
var sendMailHandler = function(cfg,req,res) {
	debugger;
	// to, subject and text are stored in req.query
	SMTPTransport.sendMail(req.query, function(error, response){
		if(error) {
			debugger;
			var error = new Error("Invalid operation");
        	error.code = 405;
        	return res.odataError(error);
		} else {
			debugger;
			return res.end(response.message);
		}
		
	});
}

/**
* PUSH Notifications
* Create a db to store users and tokens
*/
var pushDB = new Datastore( { inMemoryOnly: true });

/**
* Create notification services clients
**/
var apnConnection = new apn.Connection(config.apn.connection);
apnConnection.on('transmissionError', function (errorCode, notification, recipient) 
	{ 
		debugger;
	});
var apnFeedback = new apn.Feedback(config.apn.feedback);
apnFeedback.on('feedback', function (deviceInfos) 
	{
		debugger;
	});

var gcmConnection = new gcm.Sender(config.gcm.apiKey);  
  
/**
* main push server function to push out notifications based on device type
* @param users List of user info with push tokens and device type
* @param message The message to push
**/
var push = function(users, message) {

	if(users === undefined || message == undefined) return;	

	// arrays to store device tokens for each device type
	var andUsers = [];
	var iosUsers = [];
	var bbUsers = [];
	var wpUsers = [];
	var fireUsers = [];

	// split out tokens for each push provider
	for(var i =0; i < users.length; i ++) {
		switch(users[i].type) {
			case "android" : { andUsers.push(users[i].token); break; }
			case "ios" : { iosUsers.push(users[i].token); break; }
			case "bb" : { bbUsers.push(users[i].token); break; }
			case "wp" : { wpUsers.push(users[i].token); break; }
			case "fire" : { fireUsers.push(users[i].token); break; }
		}
	}
	
	// create payloads
	var android = {
    	"collapseKey": message.collapseKey,
    	"data": {
      		"message": message.alert
    		}
    	};
  	
  	var ios = {
    	"badge": message.badge,
    	"alert": message.alert,
    	"sound": message.sound
    };
    
    // Send out ios notifications
    if(iosUsers.length > 0) {
		var notif = new apn.Notification(ios);

		notif.expiry = ios.expiry || 0;
		notif.alert = ios.alert;
		notif.badge = ios.badge;
		notif.sound = ios.sound;

    	apnConnection.pushNotification(notif, iosUsers);
    }
    
    // Send out android notifications
    if(andUsers.length > 0) {
    	var amessage = gcm.Message(android);
    	
    	gcmConnection.send(amessage, andUsers, 4, function (err, res) {
			if(err) {
				// do something
			}

			if (res) {
				// do something
			}
		});
    }
  
}  
    
/**
* function import handler for push notifications
* @param cfg Server Config
* @param req HTTP request object (parameters are storedin req.query)
* @param res HTTP response object	
**/
var notificationHandler = function(cfg,req,res) {
	debugger;

	if(req.url.indexOf("/Notifications/send") >= 0) {
		
		// get all users for this send
		if(req.query.user.length > 0) {
			
			// find all users
			pushDB.find({ user: { $in: req.query.user }}, function (err, users) {
  				if(err) {
  					debugger;
					var error = new Error("Invalid operation");
        			error.code = 405;
        			return res.odataError(error);
  				}
  				
  				push(users,req.query.message);
  				return res.end("");
			});
			
		} else {
			return res.end("");
		}
	}
	
	if(req.url.indexOf("/Notifications/unsubscribeDevice") >= 0) {
		
		// TODO
		return res.end("");
	}
	
	if(req.url.indexOf("/Notifications/unsubscribeUser") >= 0) {
		
		// TODO
		return res.end("");
	}
	
	if(req.url.indexOf("/Notifications/subscribe") >= 0) {
		
		//lets try find the user first
		pushDB.find( { $and : [{ user : req.query.user}, { token : req.query.token }] } , function (err, user) {
			if(user.length == 0) {
				pushDB.insert( { user : req.query.user, type : req.query.type, token : req.query.token });
			}
		});
		
		return res.end("");
	}

}



/**
* function import handler for user login. password information is obfuscated
* @param cfg Server Config
* @param req HTTP request object (parameters are storedin req.query)
* @param res HTTP response object
**/
var loginHandler = function(cfg,req,res) {

	dbs[req.params.collection].find( { $and :[ {"_id" : req.query.userName }, { "password" : req.query.password } ] }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

		if(result.length == 0 ) {
			var error = new Error("Unauthorised");
        	error.code = 403;
        	return res.odataError(error);
		}
		
		// obfuscate password
		result[0].password = "*****";
		
        res.writeHead(200, {'Content-Type': 'application/json', 'OData-Version': '4.0'});

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}

var uStuckModel = {
	namespace: "ustuck",
	entityTypes: {
		"UserType": {
			"_id": { "type": "Edm.String", key: true},
			"password": { "type": "Edm.String" },
			"userType": { "type": "Edm.String" },
			"location": { "type": "ustuck.Location" },
			"businessId": { "type": "Edm.String" }
		},
		"UserInfoType": {
			"_id": { "type": "Edm.String", key: true},
			"firstName": { "type": "Edm.String" },
			"lastName": { "type" : "Edm.String" },
			"mobileNumber": { "type" : "Edm.String" },
			"addresses": { "type": "Collection(ustuck.AddressType)"},
			"rating": { "type": "Edm.String" },
			"avatarDocId" : { "type": "Edm.String" },
			"verified" : {"type": "Edm.String"},
			"vehicleReg" : {"type": "Edm.String"},
			"vehicleDesc" : {"type": "Edm.String"}
		},
		"ServiceProviderType": {
			"_id": { "type": "Edm.String", key: true},
			"companyName": { "type": "Edm.String" },
			"addresses": { "type": "Collection(ustuck.AddressType)"},
			"hours": { "type": "Edm.String" },
			"offering": { "type": "Edm.String" },
			"yearsInBusiness": { "type": "Edm.String" },
			"rate": { "type": "Edm.String" },
			"serviceTypeId" : { "type": "Edm.String" }, 
			"certificationDocId": { "type": "Edm.String" },
			"location": { "type": "ustuck.Location" },
			"rating": { "type": "Edm.String" },
			"users": { "type": "Collection(ustuck.UserType)"},
		},
		"ServiceType": {
			"_id": { "type": "Edm.String", key: true},
			"category" : { "type": "Edm.String" },
			"serviceName": { "type": "Edm.String" },
			"servicePinDocId": { "type": "Edm.String" },
			"serviceOfficeDocId": { "type": "Edm.String" },
		},
		"DocumentType": {
			"_id": { "type": "Edm.String", key: true},
			"contentType" : { "type" : "Edm.String" },
			"imageData": { "type": "Edm.String" }
		},
		"BookingType": {
			"_id": { "type": "Edm.String", key: true},
			"userId": { "type": "Edm.String" },
			"providerId": { "type": "Edm.String" },
			"time": { "type": "Edm.String" },
			"address" : { "type": "ustuck.AddressType" },
			"location" : { "type": "ustuck.Location" },
			"rate": { "type": "Edm.String" } ,
			"status": { "type": "Edm.String" }	
		},
		"FavoritesType": {
			"_id": { "type": "Edm.String", key: true},
			"providerId" : { "type" : "Edm.String" },
		},
		"MailType": {
			"_id": { "type": "Edm.String", key: true},
			"to" : { "type" : "Edm.String" },
			"subject" : { "type" : "Edm.String" },
			"text" : { "type" : "Edm.String" }
		},
		"NotificationType": {
			"_id": { "type": "Edm.String", key: true},
			"user" : { "type": "Collection(Edm.String)" },
			"type" : { "type" : "Edm.String" },
			"token" : { "type" : "Edm.String" },
			"message" : { "type": "ustuck.MessageType" }
		},
	},
	complexTypes: {
        "AddressType": {
        	"description": {"type": "Edm.String"},
            "street": {"type": "Edm.String"},
            "suburb": {"type": "Edm.String"},
            "province": {"type": "Edm.String"},
            "postalCode": {"type": "Edm.String"}
        },
        "Location": {
        	"lat": {"type": "Edm.String"},
        	"long": {"type": "Edm.String"},
        	"time": {"type": "Edm.DateTimeOffset"}
        },
        "MessageType": {
        	"collapseKey": {"type": "Edm.String"},
        	"badge": {"type": "Edm.String"},
        	"alert": {"type": "Edm.String"},
        	"sound": {"type": "Edm.String"},
        }
    },	
    entitySets: {
        "Users": {
            entityType: "ustuck.UserType",
            functions: {
            	login: loginHandler
            },
            interrupts: { 
            	query: userQueryHandler // catches query and read operations
            },
            associations: {
        		UserInfo : { field: "userInfo", from: "Users._id", to: "UserInfo._id", multiplicity : "1:1" },
        		ServiceProvider : { field: "employer", from: "Users.businessId", to: "ServiceProviders._id", multiplicity : "n:1" }
        	}
        },
        "UserInfo": {
        	entityType: "ustuck.UserInfoType"
        },
        "ServiceProviders": {
        	entityType: "ustuck.ServiceProviderType",
        	associations: {
        		Users : { field: "users", from: "ServiceProviders._id", to: "Users.businessId", multiplicity : "1:n" }
        	}
        },
        "Services": {
        	entityType: "ustuck.ServiceType"
        },
        "Documents": {
        	entityType: "ustuck.DocumentType",
        	functions: {
            	"exists" : docExistsHandler
            }
        },
        "Bookings": {
        	entityType: "ustuck.BookingType",
        	functions: {
            	"cancel" : {}
            }
        },
        "Favorites": {
        	entityType: "ustuck.FavoritesType"
        },
        "Mail": {
        	entityType: "ustuck.MailType",
        	functions: {
            	"send" : sendMailHandler
            }
        },
         "Notifications": {
        	entityType: "ustuck.NotificationType",
        	functions: {
            	send: notificationHandler,
    			subscribe: notificationHandler,
    			unsubscribeDevice: notificationHandler,
    			unsubscribeUser: notificationHandler
            }
        },

    }
};


/*
	Create the document databases to store each collection
	Currently this uses a pure in memory nedb instance.
	This will be moved to mongodb for production 
*/
for(es in uStuckModel.entitySets) {
	dbs[es] = new Datastore( { inMemoryOnly: true });
}
			
/*
	Initialise the Odata server using neDB
*/
var odataServer = require("simple-odata-server")(config.server.url(config.server))
    .model(uStuckModel)
    .onNeDB(function(es, cb) { cb(null, dbs[es])});


http.createServer(odataServer.handle.bind(odataServer)).listen(config.server.port);

dbs["Users"].insert({"_id": "craig@ssa.com", "password": "1", "userType" : "private", "location": { "lat":"-26.076", "long":"28.0008"}});
dbs["UserInfo"].insert({"_id": "craig@ssa.com", "firstName": "Craig", "lastName": "Haworth", "mobileNumber" : "072 012 1187", "addresses" : [ { "description" : "Home", "street" : "8 Frere Street", "suburb" : "Kensington B", "province" : "Gauteng" } ], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv1@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.065", "long":"28.0026"}, "businessId" : "serv1@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv1@ssa.co.za", "firstName": "Joe", "lastName": "Black", "mobileNumber" : "083 333 2154", "addresses" : [], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv2@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.055", "long":"28.0006"}, "businessId" : "serv2@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv2@ssa.co.za", "firstName": "Jim", "lastName": "Bean", "mobileNumber" : "072 555 3145", "addresses" : [], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv3@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.078", "long":"28.0066"}, "businessId" : "serv2@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv3@ssa.co.za", "firstName": "Jack", "lastName": "Ryan", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv6@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.099", "long":"28.0566"}, "businessId" : "serv30@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv6@ssa.co.za", "firstName": "Allan", "lastName": "Cowley", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv7@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.046", "long":"28.1066"}, "businessId" : "serv30@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv7@ssa.co.za", "firstName": "Wayne", "lastName": "Borcher", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null" })

dbs["Users"].insert({"_id": "serv8@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.016", "long":"28.0566"}, "businessId" : "serv30@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv8@ssa.co.za", "firstName": "Jarred", "lastName": "Cowley", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null" })

// Data for MoziCabs
dbs["Users"].insert({"_id": "serv11@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.065", "long":"28.0026"}, "businessId" : "serv32@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv11@ssa.co.za", "firstName": "Joe", "lastName": "Black", "mobileNumber" : "083 333 2154", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["Users"].insert({"_id": "serv12@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.055", "long":"28.0006"}, "businessId" : "serv32@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv12@ssa.co.za", "firstName": "Jim", "lastName": "Bean", "mobileNumber" : "072 555 3145", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["Users"].insert({"_id": "serv13@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.078", "long":"28.0066"}, "businessId" : "serv32@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv13@ssa.co.za", "firstName": "Jack", "lastName": "Ryan", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["Users"].insert({"_id": "serv16@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.099", "long":"28.0566"}, "businessId" : "serv32@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv16@ssa.co.za", "firstName": "Allan", "lastName": "Cowley", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["Users"].insert({"_id": "serv17@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.046", "long":"28.1066"}, "businessId" : "serv33@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv17@ssa.co.za", "firstName": "Wayne", "lastName": "Borcher", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["Users"].insert({"_id": "serv18@ssa.co.za", "password": "1", "userType" : "service", "location": { "lat":"-26.016", "long":"28.0566"}, "businessId" : "serv33@ssa.co.za" });
dbs["UserInfo"].insert({"_id": "serv18@ssa.co.za", "firstName": "Jarred", "lastName": "Cowley", "mobileNumber" : "084 523 8888", "addresses" : [], "avatarDocId" : "null", "vehicleReg" : "CP 5Y HG", "vehicleDesc" : "Honda - Yellow" })

dbs["ServiceProviders"].insert({	"_id": "serv1@ssa.co.za", 
									"companyName" : "First Plumbers", 
									"hours" : "9am - 5pm : mon-fri", 
									"offering" : "All plumbing services", 
									"yearsInBusiness" : "5 years", 
									"rate": "R550 / h", 
									"serviceTypeId" : "0", 
									"certificationDocId" : "",
									"location": { "lat":"-26.2044", "long":"28.0027" } } );
									
dbs["ServiceProviders"].insert({	"_id": "serv30@ssa.co.za", 
									"companyName" : "Royal Flush", 
									"hours" : "9am - 5pm : mon-fri", 
									"offering" : "All plumbing services", 
									"yearsInBusiness" : "7 years", 
									"rate": "R550", 
									"serviceTypeId" : "0", 
									"certificationDocId" : "",
									"location": { "lat":"-26.2044", "long":"28.0027" } } );									
									
dbs["ServiceProviders"].insert({	"_id": "serv2@ssa.co.za", 
									"companyName" : "Electric Worx", 
									"hours" : "9am - 5pm : mon-fri", 
									"offering" : "Home repairs of electrical equipment", 
									"yearsInBusiness" : "10 years", 
									"rate": "R750 / h", 
									"serviceTypeId" : "1", 
									"certificationDocId" : "",
									"location": { "lat":"-26.2040", "long":"28.0086" } } );
									
									
// Data for MoziCabs
dbs["ServiceProviders"].insert({	"_id": "serv32@ssa.co.za", 
									"companyName" : "Mozzie Cabs", 
									"hours" : "9am - 2am : mon-fri", 
									"offering" : "4 Seater Tax Cab", 
									"yearsInBusiness" : "10 years", 
									"rate": "R8.50 / km", 
									"serviceTypeId" : "100", 
									"certificationDocId" : "",
									"location": { "lat":"-26.2040", "long":"28.0086" } } );	

dbs["ServiceProviders"].insert({	"_id": "serv33@ssa.co.za", 
									"companyName" : "Mozzie Cabs", 
									"hours" : "9am - 2am : mon-fri", 
									"offering" : "6 Seater Taxi Cab", 
									"yearsInBusiness" : "10 years", 
									"rate": "R9.50 / km", 
									"serviceTypeId" : "101", 
									"certificationDocId" : "",
									"location": { "lat":"-26.2040", "long":"28.0086" } } );										

									
dbs["Services"].insert( {"_id": "0",  "category": "Home", "serviceName" : "Plumber", "servicePinDocId" : "plumber.png", "serviceOfficeDocId" : "plum_vend.png" } );
dbs["Services"].insert( {"_id": "1", "category": "Home", "serviceName" : "Electrician", "servicePinDocId" : "electrician.png", "serviceOfficeDocId" : "elec_vend.png" } );
dbs["Services"].insert( {"_id": "2", "category": "Home", "serviceName" : "Pest Control", "servicePinDocId" : "pest.png", "serviceOfficeDocId" : "pest_vend.png" } );
dbs["Services"].insert( {"_id": "3", "category": "Home", "serviceName" : "Locksmith", "servicePinDocId" : "lock.png" , "serviceOfficeDocId" : "lock_vend.png" } );

 
dbs["Services"].insert( {"_id": "6", "category": "Car", "serviceName" : "Locksmith", "servicePinDocId" : "lock.png", "serviceOfficeDocId" : "lock_vend.png" } );
dbs["Services"].insert( {"_id": "7", "category": "Car", "serviceName" : "Chip Repair", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "8", "category": "Car", "serviceName" : "Car Audio", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "9", "category": "Car", "serviceName" : "Windscreen", "servicePinDocId" : "wind.png", "serviceOfficeDocId" : "wind_vend.png" } );
dbs["Services"].insert( {"_id": "10", "category": "Car", "serviceName" : "Tyre Repair", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "11", "category": "Car", "serviceName" : "Tow Truck", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
 

 
dbs["Services"].insert( {"_id": "12", "category": "Beauty", "serviceName" : "Hair", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "13", "category": "Beauty", "serviceName" : "Nails", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "14", "category": "Beauty", "serviceName" : "Makeup", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
 
 
dbs["Services"].insert( {"_id": "15", "category": "Entertainment", "serviceName" : "Events", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "16", "category": "Entertainment", "serviceName" : "Party Bus", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "17", "category": "Entertainment", "serviceName" : "Tour Bus", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "18", "category": "Entertainment", "serviceName" : "DJ Services", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "19", "category": "Entertainment", "serviceName" : "Barmen", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
 
dbs["Services"].insert( {"_id": "20", "category": "Health", "serviceName" : "Personal Trainer", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "21", "category": "Health", "serviceName" : "Nutritionist", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
 
dbs["Services"].insert( {"_id": "22", "category": "Emergency", "serviceName" : "Ambulance", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "23", "category": "Emergency", "serviceName" : "Police", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );
dbs["Services"].insert( {"_id": "24", "category": "Emergency", "serviceName" : "Tow Truck", "servicePinDocId" : "pinsmall.png", "serviceOfficeDocId" : "pinsmall.png" } );

dbs["Services"].insert( {"_id": "100",  "category": "Taxi", "serviceName" : "4 Seater Taxi", "servicePinDocId" : "taxi4.png", "serviceOfficeDocId" : "taxi4.png" } );
dbs["Services"].insert( {"_id": "101", "category": "Taxi", "serviceName" : "6 Seater Taxi", "servicePinDocId" : "taxi6.png", "serviceOfficeDocId" : "taxi6.png" } );

