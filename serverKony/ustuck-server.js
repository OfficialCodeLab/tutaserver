var http = require('http');
var nodemailer = require("nodemailer");
var smtpTransport = require('nodemailer-smtp-transport');
//var app = require('connect');
var Datastore = require('nedb');
var db = new Datastore({
    inMemoryOnly: true
});
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
            "passphrase": "EN1gma45"
        },
        "feedback": {
            "address": "feedback.sandbox.push.apple.com",
            "cert": "\\uStuck\\certificates\\pushcert.pem",
            "key": "\\uStuck\\certificates\\key.pem",
            "passphrase": "EN1gma45",
            "interval": 43200,
            "batchFeedback": true
        }
    },

    "server": {
        "server": "http://localhost",
        "path": "/ustuck/services",
        "port": 8000,
        "url": function(options) {
            return options.server + ":" + options.port + options.path;
        }
    },

    "smtp": {
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

    for (var i = 0; i < result.length; i++) {
        result[i].password = "*****";
    }

    return result;
}

/*
 * Interrupt that updates status changes
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param entity The entity that was updated
 **/
var statusTrackHandler = function(cfg, req, entity) {

    // find object before update
    // clean up id
    var id = req.params.id.replace(/\"/g, "").replace(/'/g, "");

    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {

        } else {
            if (result.length > 0) {
                if (result[0].status != entity.status) {
                    // track change
                    var statusChange = {
                        "userId": id,
                        "statusFrom": result[0].status,
                        "statusTo": entity.status,
                        "location": entity.location,
                        "lastModified": Date.now()
                    }

                    dbs["StatusTracking"].insert(statusChange, function(err, res) {

                    });
                }
            }
        }

    })
    return entity;
}

/*
 * Interrupt that updates booking rating changes
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param entity The entity that was updated
 **/
var bookingRating = function(cfg, req, res) {

    updateBookingHistory(cfg, req, res, req.query.user, req.query.rating);
}


var updateBookingHistory = function(cfg, req, res, user, rating) {
    var id = req.query.id;

    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        if (result.length == 0) {
            var error = new Error("Unauthorised");
            error.code = 403;
            return res.odataError(error);
        }

        var info = result[0].info;
        info[user + "Rating"] = rating;
        dbs[req.params.collection].update({
            _id: id
        }, {
            $set: {
                info: info,
                lastModified: Date.now()
            }
        }, {}, function(err, numReplaced) {
            if (err) console.log("Booking update failed");
        });

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'OData-Version': '4.0'
        });

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}



/*
 * Interrupt that updates status changes
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param entity The entity that was updated
 **/
var updateRouteHandler = function(cfg, req, entity) {

    // find object before update
    // clean up id
    var id = req.params.id.replace(/\"/g, "").replace(/'/g, "");

    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {

        } else {
            if (result.length > 0) {
                entity.points = result[0].points.concat(entity.points);
            }
        }

    })
    return entity;
}

/**
 * function import handler to check if a document exists
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object	
 **/
var docExistsHandler = function(cfg, req, res) {

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
var sendMailHandler = function(cfg, req, res) {
    debugger;
    // to, subject and text are stored in req.query
    SMTPTransport.sendMail(req.query, function(error, response) {
        if (error) {
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
var pushDB = new Datastore({
    inMemoryOnly: true
});

/**
 * Create notification services clients
 **/
var apnConnection = new apn.Connection(config.apn.connection);
apnConnection.on('transmissionError', function(errorCode, notification, recipient) {
    //debugger;
});
var apnFeedback = new apn.Feedback(config.apn.feedback);
apnFeedback.on('feedback', function(deviceInfos) {
    //debugger;
});

var gcmConnection = new gcm.Sender(config.gcm.apiKey);

/**
 * main push server function to push out notifications based on device type
 * @param users List of user info with push tokens and device type
 * @param message The message to push
 **/
var push = function(users, message) {

    if (users === undefined || message == undefined) return;

    // arrays to store device tokens for each device type
    var andUsers = [];
    var iosUsers = [];
    var bbUsers = [];
    var wpUsers = [];
    var fireUsers = [];

    // split out tokens for each push provider
    for (var i = 0; i < users.length; i++) {
        switch (users[i].type) {
            case "android":
                {
                    andUsers.push(users[i].token);
                    break;
                }
            case "ios":
                {
                    iosUsers.push(users[i].token);
                    break;
                }
            case "bb":
                {
                    bbUsers.push(users[i].token);
                    break;
                }
            case "wp":
                {
                    wpUsers.push(users[i].token);
                    break;
                }
            case "fire":
                {
                    fireUsers.push(users[i].token);
                    break;
                }
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
    if (iosUsers.length > 0) {
        var notif = new apn.Notification(ios);

        notif.expiry = ios.expiry || 0;
        notif.alert = ios.alert;
        notif.badge = ios.badge;
        notif.sound = ios.sound;

        apnConnection.pushNotification(notif, iosUsers);
    }

    // Send out android notifications
    if (andUsers.length > 0) {
        var amessage = gcm.Message(android);

        gcmConnection.send(amessage, andUsers, 4, function(err, res) {
            if (err) {
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
var notificationHandler = function(cfg, req, res) {
    //debugger;

    if (req.url.indexOf("/Notifications/send") >= 0) {

        // get all users for this send
        if (req.query.user.length > 0) {

            // find all users
            pushDB.find({
                user: {
                    $in: req.query.user
                }
            }, function(err, users) {
                if (err) {
                    debugger;
                    var error = new Error("Invalid operation");
                    error.code = 405;
                    return res.odataError(error);
                }

                push(users, req.query.message);
                return res.end("");
            });

        } else {
            return res.end("");
        }
    }

    if (req.url.indexOf("/Notifications/unsubscribeDevice") >= 0) {

        // TODO
        return res.end("");
    }

    if (req.url.indexOf("/Notifications/unsubscribeUser") >= 0) {

        // TODO
        return res.end("");
    }

    if (req.url.indexOf("/Notifications/subscribe") >= 0) {

        //lets try find the user first
        pushDB.find({
            $and: [{
                user: req.query.user
            }, {
                token: req.query.token
            }]
        }, function(err, user) {
            if (user.length == 0) {
                pushDB.insert({
                    user: req.query.user,
                    type: req.query.type,
                    token: req.query.token
                });
            }
        });

        return res.end("");
    }

}

var closestDriversHandler = function(cfg, req, res){
	var id = req.query._id == undefined ? req.params.id : req.query._id;

    dbs[req.params.collection].find({
        "_id": id }, function(err, res){
        	if(res.length > 0){

        	} else {
                console.log("User not found, added");
                dbs[req.params.collection].insert({
                    "_id": id
                });
        	}
    });	
	var drivers;
    var driversOrdered = [];
    var currentUser;
    var orderCount = 0;
    dbs["Users"].find({
        "_id": id
    }, function(err, res) {
        currentUser = res[0];
    });
    dbs["Drivers"].find({}, function(e, r) {
        drivers = r;
        for (var i = 0; i < drivers.length; i++) {

            dbs["Users"].find({
                "_id": drivers[i]._id
            }, function(error, result) {
				
				try{
                //If there is a driver
					if (result && result[0] !== undefined) {

						var driverIsAvailable = true;

						//Check the status of the driver
						/*
						if (result[0].status === "OnDuty") {
							//Calculate the time between now and the last time the server was updated by this user
							var timeInactive = (Date.now() / 1000) - (result[0].lastModified / 1000);
							if (timeInactive < 300) { //If less than 5 mins
								driverIsAvailable = true;
							}
						}*/

						if (driverIsAvailable) {

							/* Search for rejected booking in driver list */
							var user = null;
							user = result;
								
							//Calculate distance now since driver is available
							if (user !== null) {
								var dist = distance(currentUser.location.lat, currentUser.location.lng, user[0].location.lat, user[0].location.lng);
								var driverItem = {
									id: user[0]._id,
									distance: dist,
									location: {
										lat: user[0].location.lat,
										lng: user[0].location.lng
									}
								};

								//Sort the item into the array of ordered drivers (5 max)
								if (driversOrdered.length === 0){
									driversOrdered.push(driverItem);
									if(orderCount++ === drivers.length-1)
									   updateClosestDrivers(cfg, req, res, driversOrdered);
								}
								else {
									var temp = [];

									var tempItem;
									var isGreater = false;
									while (!isGreater) {
										if (driversOrdered.length > 0) {
											//Pop the drivers into a temp array until insertion of the new driver
											tempItem = driversOrdered.pop();
											if (tempItem.distance < driverItem.distance) {
												//Insert the new driver into the array
												isGreater = true;
												driversOrdered.push(tempItem);
											} else
												temp.push(tempItem);

										} else {
											isGreater = true;
										}
									}
									driversOrdered.push(driverItem);

									//After insertion, re-add the other ordered drivers
									for (var y = 0; y < temp.length; y++) {
										driversOrdered.push(temp.pop());
									}

									//Remove drivers until the array has a max length of 5
									while (driversOrdered.length > 5) {
										driversOrdered.pop();
									}

									if(orderCount++ === drivers.length-1)
									   updateClosestDrivers(cfg, req, res, driversOrdered);
								   
								}
							}
							else{ //driver is null
								//console.log(driversOrdered);
								if(orderCount++ === drivers.length-1)
								   updateClosestDrivers(cfg, req, res, driversOrdered);
							   
							}	 
						} else { //unavailable driver
							if(orderCount++ === drivers.length-1)
							   updateClosestDrivers(cfg, req, res, driversOrdered); 
						   
						}
					}
					else {
						if(orderCount++ === drivers.length-1)
						   updateClosestDrivers(cfg, req, res, driversOrdered);
					}
				
					
				}catch(ex){
					//console.log("err");
				}
            });
        }
    });
}

/****** NOTE *******
	How to cancel a timed booking:
	
	key = id of booking
	value = timeout event
	Thus: search for the value associated with the id in timedBookings,
	call clearTimeout(value)
	
	To clear up the array:
	
	var index = timedBookings.indexOf({key:value});
	if(index > -1){
	   timedBookings.splice(index, 1);
	}
*/
var timedBookings = [];
var autoAssignDriver = function(data) {
	
	var awaitID = setInterval(function(){
		try{
			if(data._id !== undefined){
				var bookingId = data._id;
				clearInterval(awaitID);
				dbs["Bookings"].find({_id: bookingId}, function(error, success){
					//console.log(success);
					if(success[0].time === undefined){
						getClosestDriver(data, function(closestDriver, id) {
							assignNewDriver(closestDriver, id);
							autoRejectBooking(id, closestDriver, 40*1000);
						});
					} else {
						var timeout = success[0].time - Date.now();
						var timeoutFunc = setTimeout(function(){							
								dbs["Bookings"].find({_id: bookingId}, function(err, res){
									if(res[0].status === "Unconfirmed")
									{
										getClosestDriver(data, function(closestDriver, id) {
											assignNewDriver(closestDriver, id);
											autoRejectBooking(id, closestDriver, 40*1000);
										});										
									}
									
								});
							}, timeout-600000);
						var item = {bookingId : timeoutFunc};
						timedBookings.push(item);
					}
				});
        
			}
		} catch(ex){
			//console.log("Timed Out");
		}
	}, 100);
	
	
    
    
    return data;
}

var orderMatrix = function(data, driversOrdered, bookedUser, callback){
	
	//Select nearest drivers from the ordered array based on arrival time and distance along route
	var closestDriver = "";
	var shortestRoute = Number.MAX_VALUE;
	var distanceCounter = 0;
	var assigned = false;

	for (var z = 0; z < driversOrdered.length; z++) {

		var origin = [{
			lat: driversOrdered[z].location.lat,
			lng: driversOrdered[z].location.lng
		}];

		var destination = [{
			lat: bookedUser.location.lat,
			lng: bookedUser.location.lng
		}];

		distanceMatrix(origin, destination, function(requestResult, id) {
			var obj = JSON.parse(requestResult);
			var distanceMatrixVal = obj.rows[0].elements[0].distance.value * obj.rows[0].elements[0].duration.value;

			if (distanceMatrixVal < shortestRoute) {
				shortestRoute = distanceMatrixVal;
				closestDriver = driversOrdered[id].id;
			}

			distanceCounter++;
			if (distanceCounter >= driversOrdered.length - 1 && assigned === false) {
				assigned = true;
				//Callback with all relevant data
				callback(closestDriver, data._id);
			}
		}, z);

	}
}

var getClosestDriver = function(data, callback) {
    var drivers;
    var driversOrdered = [];
    var bookedUser;
	var orderCount = 0;
    dbs["Users"].find({
        "_id": data.userId
    }, function(err, res) {
        bookedUser = res[0];
    });
    dbs["Drivers"].find({}, function(e, r) {
        drivers = r;
        for (var i = 0; i < drivers.length; i++) {

            dbs["Users"].find({
                "_id": drivers[i]._id
            }, function(error, result) {

                //If there is a driver
                if (result) {
					try{
					
						var driverIsAvailable = false;

						//Check the status of the driver
						if (result[0].status === "OnDuty") {
							//Calculate the time between now and the last time the server was updated by this user
							var timeInactive = (Date.now() / 1000) - (result[0].lastModified / 1000);
							//console.log(timeInactive);
							if (timeInactive < 300) { //If less than 5 mins
								driverIsAvailable = true;
							}
						}

						if (driverIsAvailable) {

							/* Search for rejected booking in driver list */
							var user = null;
							var userId = null;
							if (result[0] !== undefined)
								userId = result[0]._id;
							dbs["RejectedBookings"].find({
								"_id": userId
							}, function(err, res) {
								try {
									var hasRejected = false;
									for (var j = 0; j < res[0].bookings.length; j++) {
										if (res[0].bookings[j] === data._id) {
											hasRejected = true;
										}
									}
									if (hasRejected === false) {
										user = result;
									}
								} catch (ex) {
									user = result;
								}


								//Calculate distance now since driver is available
								if (user !== null && userId !== null) {
									var dist = distance(bookedUser.location.lat, bookedUser.location.lng, user[0].location.lat, user[0].location.lng);
									var driverItem = {
										id: user[0]._id,
										distance: dist,
										location: {
											lat: user[0].location.lat,
											lng: user[0].location.lng
										}
									};

									//Sort the item into the array of ordered drivers (5 max)
									if (driversOrdered.length === 0)
									{
										//console.log(drivers.length + " Run seq(ins): " + orderCount+"\n" + result[0]._id);
										driversOrdered.push(driverItem);
										if(orderCount++ === drivers.length-1){
											orderMatrix(data, driversOrdered, bookedUser, callback);
										}
									}
									else {
										var temp = [];

										var tempItem;
										var isGreater = false;
										while (!isGreater) {
											if (driversOrdered.length > 0) {
												//Pop the drivers into a temp array until insertion of the new driver
												tempItem = driversOrdered.pop();
												if (tempItem.distance < driverItem.distance) {
													//Insert the new driver into the array
													isGreater = true;
													driversOrdered.push(tempItem);
												} else
													temp.push(tempItem);

											} else {
												isGreater = true;
											}
										}
										driversOrdered.push(driverItem);

										//After insertion, re-add the other ordered drivers
										for (var y = 0; y < temp.length; y++) {
											driversOrdered.push(temp.pop());
										}

										//Remove drivers until the array has a max length of 5
										while (driversOrdered.length > 5) {
											driversOrdered.pop();
										}
										//console.log(drivers.length + " Run seq(ord): " + orderCount+"\n" + result[0]._id);
										if(orderCount++ === drivers.length-1){
											orderMatrix(data, driversOrdered, bookedUser, callback);
										}
									}

								} else {
									//driver has rejected
									//console.log(drivers.length + " Run seq(rej): " + orderCount+"\n" + result[0]._id);
									if(orderCount++ === drivers.length-1){
										orderMatrix(data, driversOrdered, bookedUser, callback);
									}
								}
							});
						} else {
							//unavailable drivers
							//console.log(drivers.length + " Run seq(un): " + orderCount+"\n" + result[0]._id);
							if(orderCount++ === drivers.length-1){
								orderMatrix(data, driversOrdered, bookedUser, callback);
							}
						}
					}catch(ex){						
						if(orderCount++ === drivers.length-1){
							orderMatrix(data, driversOrdered, bookedUser, callback);
						}
						
					}
                } else {
					//No Result
				}
            });
        }
    });
}

var assignNewDriver = function(provider, id) {
    dbs["Bookings"].update({
        _id: id
    }, {
        $set: {
            "providerId": provider
        }
    }, function(s, e) {
		dbs["Bookings"].update({_id: id}, {$set :{status : "Unconfirmed"}}, function(error, result){});
    });
}



var distanceMatrix = function(origins, destinations, callback, id) {
    var originparam = "";
    var destparam = "";

    for (var i = 0; i < origins.length; i++) {
        originparam += origins[i].lat + "," + origins[i].lng;
        if (i < origins.length - 1) originparam += "|";

    }

    for (var j = 0; j < destinations.length; j++) {
        destparam += destinations[j].lat + "," + destinations[j].lng;
        if (j < destinations.length - 1) destparam += "|";
    }

    var http = require('http');


    var options = {
        host: 'maps.googleapis.com',
        path: '/maps/api/distancematrix/json?origins=' + originparam + '&destinations=' + destparam
    };

    call = function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so callback here
        response.on('end', function() {
            callback(str, id);
        });
    }

    http.request(options, call).end();

};

//Automatically reject a booking set to a driver after a set amount of time (milliseconds)
var autoRejectBooking = function(id, providerId, time){
	setTimeout(function(){
		dbs["Bookings"].find({_id: id}, function(error, result){
			if(result[0].status === "Unconfirmed"){
				if(result[0].status !== "Rejected"){
					if(result[0].providerId === providerId)
						rejectBookingInternal(providerId, result[0].userId, id);
				}
			}
		})
	}, time);

}

//Internal method for rejecting a booking
var rejectBookingInternal = function(providerId, userId, id) {

	dbs["Bookings"].update({_id: id}, {$set :{status : "Rejected"}}, function(error, result){		
		concatRejections(providerId, id, function(){
			var data = {
				_id : id,
				userId : userId
			};
			getClosestDriver(data, function(closestDriver, id) {
                assignNewDriver(closestDriver, id);
				autoRejectBooking(id, closestDriver, 40*1000);});
		});	
	});	
}

var distance = function(lat1, lon1, lat2, lon2) {
    var R = 6371000; // metres
    var o1 = lat1 * Math.PI / 180;
    var o2 = lat2 * Math.PI / 180;
    var dO = (lat2 - lat1) * Math.PI / 180;
    var dA = (lon2 - lon1) * Math.PI / 180;

    var a = Math.sin(dO / 2) * Math.sin(dO / 2) +
        Math.cos(o1) * Math.cos(o2) *
        Math.sin(dA / 2) * Math.sin(dA / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};


var autoFillMessage = function(data) {
    data.time = Date.now();
    data.status = "0";

    return data;
}


/**
 * function import handler for user login. password information is obfuscated
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object
 **/
var loginHandler = function(cfg, req, res) {

    dbs[req.params.collection].find({
        $and: [{
            "_id": req.query.userName
        }, {
            "password": req.query.password
        }]
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        if (result.length == 0) {
            var error = new Error("Unauthorised");
            error.code = 403;
            return res.odataError(error);
        }

        // obfuscate password
        result[0].password = "*****";

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'OData-Version': '4.0'
        });

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}

var updateBooking = function(cfg, req, res, newstatus) {
    var id = req.query._id == undefined ? req.params.id : req.query._id;

    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        if (result.length == 0) {
            var error = new Error("Unauthorised");
            error.code = 403;
            return res.odataError(error);
        }

        var booking = result[0];
        booking.status = newstatus;
        dbs[req.params.collection].update({
            _id: id
        }, {
            $set: {
                status: newstatus,
                lastModified: Date.now()
            }
        }, {}, function(err, numReplaced) {
            if (err) console.log("Booking update failed");
        });

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'OData-Version': '4.0'
        });

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}

var updateClosestDrivers = function(cfg, req, res, newdrivers) {
    var id = req.query._id == undefined ? req.params.id : req.query._id;

	//console.log(newdrivers);
    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        if (result.length == 0) {
            var error = new Error("Unauthorised");
            error.code = 403;
            return res.odataError(error);
        }

        var user = result[0];
        user.drivers = newdrivers;
        dbs[req.params.collection].update({
            _id: id
        }, {
            $set: {
                drivers: newdrivers
            }
        }, {}, function(error, res) {
            if (error) console.log("Item update failed");
        });

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'OData-Version': '4.0'
        });

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}

/**
 * function import handler for user login. password information is obfuscated
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object
 **/
var cancelBookingHandler = function(cfg, req, res) {
    //console.log(JSON.stringify(req.params.collection));
    updateBooking(cfg, req, res, "Cancelled");
}

/**
 * function import handler for user login. password information is obfuscated
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object
 **/
var acceptBookingHandler = function(cfg, req, res) {
    updateBooking(cfg, req, res, "OnRoute");
}

/**
 * function import handler for user login. password information is obfuscated
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object
 **/
var rejectBookingHandler = function(cfg, req, res) {
    dbs["Bookings"].find({
        _id: req.params.id
    }, function(error, result) {
        concatRejections(result[0].providerId, result[0]._id, function() {
            getClosestDriver(result[0], function(closestDriver, id) {
                assignNewDriver(closestDriver, id);
				autoRejectBooking(id, closestDriver, 40*1000);
            });
        });;
    });
    updateBooking(cfg, req, res, "Rejected");
}

var concatRejections = function(providerId, id, callback) {
    var rejections = [];

    dbs["RejectedBookings"].find({
        "_id": providerId
    }, function(err, result) {
        if (err) {
            dbs["RejectedBookings"].insert({
                "_id": providerId
            });
            concatRejections(providerId, id, callback);
            //console.log(err);
        } else {
            if (result.length > 0) {
                if (result.bookings != undefined) {
                    rejections = result.bookings.concat(id);
                    updateRejections(providerId, id, rejections, callback);
                    //console.log("Added a  rejection");
                } else {
                    rejections.push(id);
                    //console.log("User found, added first rejection");
                    updateRejections(providerId, id, rejections, callback);
                }
            } else {
                //console.log("User not found, added");
                dbs["RejectedBookings"].insert({
                    "_id": providerId
                });
                concatRejections(providerId, id, callback);
            }

        }

    });
}


var updateRejections = function(providerId, id, rejections, callback) {
    dbs["RejectedBookings"].update({
            _id: providerId
        }, {
            $set: {
                "bookings": rejections
            }
        },
        function(e, s) {
            callback();
        });
}

/**
 * function import handler for user login. password information is obfuscated
 * @param cfg Server Config
 * @param req HTTP request object (parameters are storedin req.query)
 * @param res HTTP response object
 **/
var trackBookingHandler = function(cfg, req, res) {
    updateBooking(cfg, req, res, "Tracking");
}

var updateMessage = function(cfg, req, res, newstatus) {
    var id = req.query._id == undefined ? req.params.id : req.query._id;

    dbs[req.params.collection].find({
        "_id": id
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        if (result.length == 0) {
            var error = new Error("Unauthorised");
            error.code = 403;
            return res.odataError(error);
        }

        var message = result[0];
        message.status = newstatus;
        dbs[req.params.collection].update({
            _id: id
        }, {
            $set: {
                status: newstatus,
                lastModified: Date.now()
            }
        }, {}, function(err, numReplaced) {
            if (err) console.log("Message update failed");
        });

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'OData-Version': '4.0'
        });

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": result
        }

        return res.end(JSON.stringify(out));
    });
}

var readMessageHandler = function(cfg, req, res) {
    updateMessage(cfg, req, res, "1");
}

var averageRatingHandler = function(cfg, req, res) {
    dbs[req.params.collection].find({
        "userId": req.params.id
    }, function(err, result) {
        if (err) {
            return res.odataError(err);
        }

        var total = 0;
        var ave = 0;

        if (result.length > 0) {
            for (var i = 0; i < result.length; i++) {
                total = total + result[i].rating;
            }

            ave = total / result.length;
        }

        var out = {
            "@odata.context": cfg.serviceUrl + "/$metadata#" + req.params.collection,
            "value": {
                "averageRating": ave
            }
        }

        return res.end(JSON.stringify(out));
    });
}

var logIssueHandler = function(data) {
    //TODO: Send email to provider

    var mail = {
        to: data.providerId,
        subject: data.queryTopic,
        text: data.queryFull
    };

    SMTPTransport.sendMail(mail, function(error, response) {
        if (error) {
            console.log(error);
            debugger;
        } else {
            console.log("Mail Sent!");
            debugger;
        }

    });

    return data;

}


var uStuckModel = {
    namespace: "ustuck",
    entityTypes: {
        "UserType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "password": {
                "type": "Edm.String"
            },
            "userType": {
                "type": "Edm.String"
            },
            "location": {
                "type": "ustuck.Location"
            },
            "businessId": {
                "type": "Edm.String"
            },
            "status": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "StatusTrackingType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "userId": {
                "type": "Edm.String"
            },
            "statusFrom": {
                "type": "Edm.String"
            },
            "location": {
                "type": "ustuck.Location"
            },
            "statusTo": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "RejectedBookingsType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "bookings": {
                "type": "Collection(Edm.String)"
            }
        },
        "ClosestDriversType" :{
        	"_id" : {
        		"type" : "Edm.String",
        		key: true
        	},
        	"drivers" : {
        		"type" :"Collection(ustuck.DriverDistanceType)"
        	}
        },
        "UserInfoType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "firstName": {
                "type": "Edm.String"
            },
            "lastName": {
                "type": "Edm.String"
            },
            "mobileNumber": {
                "type": "Edm.String"
            },
            "addresses": {
                "type": "Collection(ustuck.AddressType)"
            },
            "rating": {
                "type": "Edm.String"
            },
            "avatarDocId": {
                "type": "Edm.String"
            },
            "verified": {
                "type": "Edm.String"
            },
            "rejectedBookings": {
                "type": "Collection(Edm.String)"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "RouteType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "points": {
                "type": "Collection(ustuck.Location)"
            }
        },
        "DriverType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "licenseNumber": {
                "type": "Edm.String"
            },
            "assignedVehicle": {
                "type": "Edm.String"
            },
            "taxiLicenseNumber": {
                "type": "Edm.String"
            },
            "rejectedBookings": {
                "type": "Collection(Edm.String)"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "CheckListTemplateType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "templateId": {
                "type": "Edm.String"
            },
            "order": {
                "type": "Edm.Integer"
            },
            "text": {
                "type": "Edm.String"
            },
            "resultType": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "CheckListResultType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "templateId": {
                "type": "Edm.String"
            },
            "userId": {
                "type": "Edm.String"
            },
            "result": {
                "type": "Edm.String"
            },
            "date": {
                "type": "Edm.DateTime"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "ServiceProviderType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "companyName": {
                "type": "Edm.String"
            },
            "addresses": {
                "type": "Collection(ustuck.AddressType)"
            },
            "hours": {
                "type": "Edm.String"
            },
            "offering": {
                "type": "Edm.String"
            },
            "yearsInBusiness": {
                "type": "Edm.String"
            },
            "rate": {
                "type": "Edm.String"
            },
            "serviceTypeId": {
                "type": "Edm.String"
            },
            "certificationDocId": {
                "type": "Edm.String"
            },
            "location": {
                "type": "ustuck.Location"
            },
            "rating": {
                "type": "Edm.String"
            },
            "users": {
                "type": "Collection(ustuck.UserType)"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "ServiceType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "category": {
                "type": "Edm.String"
            },
            "serviceName": {
                "type": "Edm.String"
            },
            "servicePinDocId": {
                "type": "Edm.String"
            },
            "serviceOfficeDocId": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "DocumentType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "contentType": {
                "type": "Edm.String"
            },
            "imageData": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "BookingType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "userId": {
                "type": "Edm.String"
            },
            "providerId": {
                "type": "Edm.String"
            },
            "time": {
                "type": "Edm.String"
            },
            "address": {
                "type": "ustuck.AddressType"
            },
            "location": {
                "type": "ustuck.Location"
            },
            "rate": {
                "type": "Edm.String"
            },
            "status": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "VehicleType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "color": {
                "type": "Edm.String"
            },
            "make": {
                "type": "Edm.String"
            },
            "model": {
                "type": "Edm.String"
            },
            "year": {
                "type": "Edm.String"
            },
            "VIN": {
                "type": "Edm.String"
            },
            "VLN": {
                "type": "Edm.String"
            },
            "VRN": {
                "type": "Edm.String"
            },
            "licenseDate": {
                "type": "Edm.DateTime"
            },
            "identifier": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "RatingType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "userId": {
                "type": "Edm.String"
            },
            "ratorId": {
                "type": "Edm.String"
            },
            "rating": {
                "type": "Edm.Integer"
            },
            "comment": {
                "type": "Edm.String"
            },
        },
        "FavoritesType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "providerId": {
                "type": "Edm.String"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "MailType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "to": {
                "type": "Edm.String"
            },
            "subject": {
                "type": "Edm.String"
            },
            "text": {
                "type": "Edm.String"
            }
        },
        "NotificationType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "user": {
                "type": "Collection(Edm.String)"
            },
            "type": {
                "type": "Edm.String"
            },
            "token": {
                "type": "Edm.String"
            },
            "message": {
                "type": "ustuck.MessageType"
            }
        },
        "ConfigType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "PollInterval": {
                "type": "Edm.Integer"
            },
            "DriverCandidateCount": {
                "type": "Edm.Integer"
            },
            "QProcessInterval": {
                "type": "Edm.Integer"
            },
            "ArrivingDistance": {
                "type": "Edm.Integer"
            },
            "ArrivedDistance": {
                "type": "Edm.Integer"
            },
            "SoonToClearDistance": {
                "type": "Edm.Integer"
            }
        },
        "PersonalMessageType": {
            "collapseKey": {
                "type": "Edm.String"
            },
            "badge": {
                "type": "Edm.String"
            },
            "alert": {
                "type": "Edm.String"
            },
            "sound": {
                "type": "Edm.String"
            },
        },
        "BookingHistoryType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "userId": {
                "type": "Edm.String"
            },
            "providerId": {
                "type": "Edm.String"
            },
            "address": {
                "type": "Collection(Edm.String)"
            },
            "info": {
                "type": "Collection(ustuck.BookingInfo)"
            },
            "lastModified": {
                "type": "Edm.DateTime"
            }
        },
        "LogIssueType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "userId": {
                "type": "Edm.String"
            },
            "providerId": {
                "type": "Edm.String"
            },
            "email": {
                "type": "Edm.String"
            },
            "userName": {
                "type": "Edm.String"
            },
            "companyName": {
                "type": "Edm.String"
            },
            "queryTopic": {
                "type": "Edm.String"
            },
            "queryFull": {
                "type": "Edm.String"
            },
            "date": {
                "type": "Edm.DateTime"
            },
            "status": {
                "type": "Edm.String"
            }
        },
        "RouteType": {
            "_id": {
                "type": "Edm.String",
                key: true
            },
            "points": {
                "type": "Collection(ustuck.location)"
            }
        }

    },
    complexTypes: {
        "AddressType": {
            "description": {
                "type": "Edm.String"
            },
            "street": {
                "type": "Edm.String"
            },
            "suburb": {
                "type": "Edm.String"
            },
            "province": {
                "type": "Edm.String"
            },
            "postalCode": {
                "type": "Edm.String"
            }
        },
        "Location": {
            "lat": {
                "type": "Edm.String"
            },
            "lng": {
                "type": "Edm.String"
            },
            "direction": {
                "type": "Edm.String"
            },
            "time": {
                "type": "Edm.DateTimeOffset"
            }
        },
        "MessageType": {
            "collapseKey": {
                "type": "Edm.String"
            },
            "badge": {
                "type": "Edm.String"
            },
            "alert": {
                "type": "Edm.String"
            },
            "sound": {
                "type": "Edm.String"
            },
        },
        "BookingInfo": {
            "date": {
                "type": "Edm.DateTime"
            },
            "cost": {
                "type": "Edm.String"
            },
            "customerRating": {
                "type": "Edm.Integer"
            },
            "driverRating": {
                "type": "Edm.Integer"
            },
        },
        "DriverDistanceType" : {
        	"id": "Edm.String",
            "distance": "Edm.String",
            "location": {
                "lat": {
                "type": "Edm.String"
		        },
		        "lng": {
		            "type": "Edm.String"
		        },
            }
        }
    },
    entitySets: {
        "Users": {
            entityType: "ustuck.UserType",
            functions: {
                login: loginHandler
            },
            interrupts: {
                query: userQueryHandler, // catches query and read operations
                update: statusTrackHandler
            },
            associations: {
                UserInfo: {
                    field: "userInfo",
                    from: "Users._id",
                    to: "UserInfo._id",
                    multiplicity: "1:1"
                },
                ServiceProvider: {
                    field: "employer",
                    from: "Users.businessId",
                    to: "ServiceProviders._id",
                    multiplicity: "n:1"
                }
            }
        },
        "RejectedBookings": {
            entityType: "ustuck.RejectedBookingsType"
        },
        "ClosestDrivers": {
            entityType: "ustuck.ClosestDriversType",
            functions: {
            	closest: closestDriversHandler
            }
        },
        "UserInfo": {
            entityType: "ustuck.UserInfoType"
        },
        "StatusTracking": {
            entityType: "ustuck.StatusTrackingType"
        },
        "Drivers": {
            entityType: "ustuck.DriverType",
            associations: {
                Vehicles: {
                    field: "vehicle",
                    from: "Drivers.assignedVehicle",
                    to: "Vehicles._id",
                    multiplicity: "1:1"
                }
            }
        },
        "CheckListTemplate": {
            entityType: "ustuck.CheckListTemplateoType"
        },
        "CheckListResult": {
            entityType: "ustuck.CheckListResultType"
        },
        "ServiceProviders": {
            entityType: "ustuck.ServiceProviderType",
            associations: {
                Users: {
                    field: "users",
                    from: "ServiceProviders._id",
                    to: "Users.businessId",
                    multiplicity: "1:n"
                }
            }
        },
        "Services": {
            entityType: "ustuck.ServiceType"
        },
        "Ratings": {
            entityType: "ustuck.RatingType",
            functions: {
                "average": averageRatingHandler
            }
        },
        "Vehicles": {
            entityType: "ustuck.VehicleType"
        },
        "Documents": {
            entityType: "ustuck.DocumentType",
            functions: {
                "exists": docExistsHandler
            }
        },
        "Bookings": {
            entityType: "ustuck.BookingType",
            interrupts: {
                create: autoAssignDriver
            },
            functions: {
                "cancel": cancelBookingHandler,
                "accept": acceptBookingHandler,
                "reject": rejectBookingHandler,
                "track": trackBookingHandler
            }
        },
        "Routes": {
            entityType: "ustuck.RouteType",
            interrupts: {
                update: updateRouteHandler
            }
        },
        "Favorites": {
            entityType: "ustuck.FavoritesType"
        },
        "Mail": {
            entityType: "ustuck.MailType",
            functions: {
                "send": sendMailHandler
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
        "BookingHistory": {
            entityType: "ustuck.BookingHistoryType",
            functions: {
                "updateRating": bookingRating
            },
        },
        "LogIssue": {
            entityType: "ustuck.LogIssueType",
            interrupts: {
                create: logIssueHandler
            }
        },
        "PersonalMessage": {
            entityType: "ustuck.PersonalMessageType",
            interrupts: {
                create: autoFillMessage
            },
            functions: {
                "readMessage": readMessageHandler
            }
        },
        "Route": {
            entityType: "ustuck.RouteType",
            interrupts: {
                update: updateRouteHandler
            }
        }

    }
};


/*
	Create the document databases to store each collection
	Currently this uses a pure in memory nedb instance.
	This will be moved to mongodb for production 
*/
for (es in uStuckModel.entitySets) {
    dbs[es] = new Datastore({
        inMemoryOnly: true
    });
}

/*
	Initialise the Odata server using neDB
*/
var odataServer = require("simple-odata-server")(config.server.url(config.server))
    .model(uStuckModel)
    .onNeDB(function(es, cb) {
        cb(null, dbs[es])
    });


http.createServer(odataServer.handle.bind(odataServer)).listen(config.server.port);

dbs["Users"].insert({
    "_id": "craig@ssa.com",
    "password": "1",
    "userType": "private",
    "location": {
        "lat": "-26.076",
        "lng": "28.0008"
    },
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "craig@ssa.com",
    "firstName": "Craig",
    "lastName": "Haworth",
    "mobileNumber": "072 012 1187",
    "addresses": [{
        "description": "Home",
        "street": "8 Frere Street",
        "suburb": "Kensington B",
        "province": "Gauteng"
    }],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "courtney@codelab.io",
    "password": "1",
    "userType": "private",
    "location": {
        "lat": "-34.0836",
        "lng": "18.8413"
    },
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "courtney@codelab.io",
    "firstName": "Courtney",
    "lastName": "Jooste",
    "mobileNumber": "072 258 4747",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})


dbs["Ratings"].insert({
    "userId": "craig@ssa.com",
    "rating": 4
});
dbs["Ratings"].insert({
    "userId": "craig@ssa.com",
    "rating": 3
});
dbs["Ratings"].insert({
    "userId": "craig@ssa.com",
    "rating": 5
});
dbs["Ratings"].insert({
    "userId": "craig@ssa.com",
    "rating": 3
});
dbs["Ratings"].insert({
    "userId": "craig@ssa.com",
    "rating": 4
});


dbs["Vehicles"].insert({
    "_id": "TESTV",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 65 YD GP",
    "identifier": "157"
});
dbs["Vehicles"].insert({
    "_id": "TESTV1",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 66 YD GP",
    "identifier": "158"
});
dbs["Vehicles"].insert({
    "_id": "TESTV2",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 67 YD GP",
    "identifier": "159"
});
dbs["Vehicles"].insert({
    "_id": "TESTV3",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 68 YD GP",
    "identifier": "160"
});
dbs["Vehicles"].insert({
    "_id": "TESTV4",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 69 YD GP",
    "identifier": "161"
});
dbs["Vehicles"].insert({
    "_id": "TESTV5",
    "make": "Mercedes",
    "model": "E350",
    "year": "2013",
    "VRN": "CP 60 YD GP",
    "identifier": "162"
});
dbs["Drivers"].insert({
    "_id": "craig@ssa.com",
    "assignedVehicle": "TESTV"
});
dbs["Drivers"].insert({
    "_id": "driver1@test.com",
    "assignedVehicle": "TESTV1"
});
dbs["Drivers"].insert({
    "_id": "driver2@test.com",
    "assignedVehicle": "TESTV2"
});
dbs["Drivers"].insert({
    "_id": "driver3@test.com",
    "assignedVehicle": "TESTV3"
});
dbs["Drivers"].insert({
    "_id": "driver4@test.com",
    "assignedVehicle": "TESTV4"
});
dbs["Drivers"].insert({
    "_id": "driver5@test.com",
    "assignedVehicle": "TESTV5"
});
dbs["Drivers"].insert({
    "_id": "driver6@test.com",
    "assignedVehicle": "TESTV6"
});

dbs["Users"].insert({
    "_id": "serv1@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-26.065",
        "lng": "28.0026"
    },
    "businessId": "serv1@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv1@ssa.co.za",
    "firstName": "Joe",
    "lastName": "Black",
    "mobileNumber": "083 333 2154",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "serv2@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-26.055",
        "lng": "28.0006"
    },
    "businessId": "serv2@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv2@ssa.co.za",
    "firstName": "Jim",
    "lastName": "Bean",
    "mobileNumber": "072 555 3145",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "serv3@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-26.078",
        "lng": "28.0066"
    },
    "businessId": "serv2@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv3@ssa.co.za",
    "firstName": "Jack",
    "lastName": "Ryan",
    "mobileNumber": "084 523 8888",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "serv6@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-26.099",
        "lng": "28.0566"
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv6@ssa.co.za",
    "firstName": "Allan",
    "lastName": "Cowley",
    "mobileNumber": "084 523 8888",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "serv7@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-25.946",
        "lng": "28.1066"
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv7@ssa.co.za",
    "firstName": "Wayne",
    "lastName": "Borcher",
    "mobileNumber": "084 523 8888",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "serv8@ssa.co.za",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-25.9992",
        "lng": "28.0566"
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "serv8@ssa.co.za",
    "firstName": "Jarred",
    "lastName": "Cowley",
    "mobileNumber": "084 523 8888",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "driver1@test.com",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-34.066287",
        "lng": "18.846423",
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "driver1@test.com",
    "firstName": "Simeon",
    "lastName": "Panda",
    "mobileNumber": "084 523 8880",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "driver2@test.com",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-34.060169",
        "lng": "18.841633",
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "driver2@test.com",
    "firstName": "Mr",
    "lastName": "Chow",
    "mobileNumber": "084 523 8887",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "driver3@test.com",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-34.066334",
        "lng": "18.862812",
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "driver3@test.com",
    "firstName": "Solms",
    "lastName": "Delta",
    "mobileNumber": "084 523 8886",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "driver4@test.com",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-34.071557",
        "lng": "18.870554"
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "driver4@test.com",
    "firstName": "Michael",
    "lastName": "Hunt",
    "mobileNumber": "084 523 8885",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["Users"].insert({
    "_id": "driver5@test.com",
    "password": "1",
    "userType": "service",
    "location": {
        "lat": "-34.035733",
        "lng": "18.830928"
    },
    "businessId": "serv30@ssa.co.za",
    "lastModified": Date.now()
});
dbs["UserInfo"].insert({
    "_id": "driver5@test.com",
    "firstName": "John",
    "lastName": "Smith",
    "mobileNumber": "084 523 8884",
    "addresses": [],
    "avatarDocId": "null",
    "lastModified": Date.now()
})

dbs["ServiceProviders"].insert({
    "_id": "serv1@ssa.co.za",
    "companyName": "First Plumbers",
    "hours": "9am - 5pm : mon-fri",
    "offering": "All plumbing services",
    "yearsInBusiness": "5 years",
    "rate": "R550 / h",
    "serviceTypeId": "0",
    "certificationDocId": "",
    "location": {
        "lat": "-26.2044",
        "lng": "28.0027"
    }
});

dbs["ServiceProviders"].insert({
    "_id": "serv30@ssa.co.za",
    "companyName": "Royal Flush",
    "hours": "9am - 5pm : mon-fri",
    "offering": "All plumbing services",
    "yearsInBusiness": "7 years",
    "rate": "R550",
    "serviceTypeId": "0",
    "certificationDocId": "",
    "location": {
        "lat": "-26.2044",
        "lng": "28.0027"
    }
});

dbs["ServiceProviders"].insert({
    "_id": "serv2@ssa.co.za",
    "companyName": "Electric Worx",
    "hours": "9am - 5pm : mon-fri",
    "offering": "Home repairs of electrical equipment",
    "yearsInBusiness": "10 years",
    "rate": "R750 / h",
    "serviceTypeId": "1",
    "certificationDocId": "",
    "location": {
        "lat": "-26.2040",
        "lng": "28.0086"
    }
});

dbs["Services"].insert({
    "_id": "0",
    "category": "Home",
    "serviceName": "Plumber",
    "servicePinDocId": "plumber.png",
    "serviceOfficeDocId": "plum_vend.png"
});
dbs["Services"].insert({
    "_id": "1",
    "category": "Home",
    "serviceName": "Electrician",
    "servicePinDocId": "electrician.png",
    "serviceOfficeDocId": "elec_vend.png"
});
dbs["Services"].insert({
    "_id": "2",
    "category": "Home",
    "serviceName": "Pest Control",
    "servicePinDocId": "pest.png",
    "serviceOfficeDocId": "pest_vend.png"
});
dbs["Services"].insert({
    "_id": "3",
    "category": "Home",
    "serviceName": "Locksmith",
    "servicePinDocId": "lock.png",
    "serviceOfficeDocId": "lock_vend.png"
});


dbs["Services"].insert({
    "_id": "6",
    "category": "Car",
    "serviceName": "Locksmith",
    "servicePinDocId": "lock.png",
    "serviceOfficeDocId": "lock_vend.png"
});
dbs["Services"].insert({
    "_id": "7",
    "category": "Car",
    "serviceName": "Chip Repair",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "8",
    "category": "Car",
    "serviceName": "Car Audio",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "9",
    "category": "Car",
    "serviceName": "Windscreen",
    "servicePinDocId": "wind.png",
    "serviceOfficeDocId": "wind_vend.png"
});
dbs["Services"].insert({
    "_id": "10",
    "category": "Car",
    "serviceName": "Tyre Repair",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "11",
    "category": "Car",
    "serviceName": "Tow Truck",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});



dbs["Services"].insert({
    "_id": "12",
    "category": "Beauty",
    "serviceName": "Hair",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "13",
    "category": "Beauty",
    "serviceName": "Nails",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "14",
    "category": "Beauty",
    "serviceName": "Makeup",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});


dbs["Services"].insert({
    "_id": "15",
    "category": "Entertainment",
    "serviceName": "Events",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "16",
    "category": "Entertainment",
    "serviceName": "Party Bus",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "17",
    "category": "Entertainment",
    "serviceName": "Tour Bus",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "18",
    "category": "Entertainment",
    "serviceName": "DJ Services",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "19",
    "category": "Entertainment",
    "serviceName": "Barmen",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});

dbs["Services"].insert({
    "_id": "20",
    "category": "Health",
    "serviceName": "Personal Trainer",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "21",
    "category": "Health",
    "serviceName": "Nutritionist",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});

dbs["Services"].insert({
    "_id": "22",
    "category": "Emergency",
    "serviceName": "Ambulance",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "23",
    "category": "Emergency",
    "serviceName": "Police",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});
dbs["Services"].insert({
    "_id": "24",
    "category": "Emergency",
    "serviceName": "Tow Truck",
    "servicePinDocId": "pinsmall.png",
    "serviceOfficeDocId": "pinsmall.png"
});

dbs["Services"].insert({
    "_id": "100",
    "category": "Taxi",
    "serviceName": "4 Seater Taxi",
    "servicePinDocId": "taxi4.png",
    "serviceOfficeDocId": "taxi4.png"
});
dbs["Services"].insert({
    "_id": "101",
    "category": "Taxi",
    "serviceName": "6 Seater Taxi",
    "servicePinDocId": "taxi6.png",
    "serviceOfficeDocId": "taxi6.png"
});

dbs["BookingHistory"].insert({
    "_id": "82",
    "providerId": "craig@ssa.com",
    "userId": "courtney@codelab.io",
    "address": {
        "start": "42 Bright Street, Audas Estate, Somerset West, 7130",
        "end": "90 Parel Valley, Somerset West, 7130"
    },
    info: {
        "date": "1449649771000",
        "cost": "86.98",
        "customerRating": "4",
        "driverRating": "5"
    },
    "lastModified": Date.now()
});

dbs["PersonalMessage"].insert({
    "_id": "100831",
    "providerId": "craig@ssa.com",
    "time": Date.now(),
    "text": "Hi, this is a test. Please be my friend.",
    "sender": "serv8@ssa.co.za",
    "status": "0"
});

dbs["Route"].insert({
    "_id": "1234567",
    "points": [{
        "lat": "34.0863123",
        "lng": "15.12391923"
    }, {
        "lat": "34.5125111",
        "lng": "15.13213555"
    }, {
        "lat": "34.0412444",
        "lng": "15.12552123"
    }]
});


dbs["CheckListResult"].insert({
    "_id": "1",
    "templateId": "TUTA",
    "result": "Have you performed break light and indicator checks?",
    "date": Date.now(),
    "lastModified": Date.now()
});

dbs["CheckListResult"].insert({
    "_id": "2",
    "templateId": "TUTA",
    "result": "Is your vehicle registration still valid?",
    "date": Date.now(),
    "lastModified": Date.now()
});

dbs["CheckListResult"].insert({
    "_id": "3",
    "templateId": "TUTA",
    "result": "Is your check engine light off?",
    "date": Date.now(),
    "lastModified": Date.now()
});

dbs["CheckListResult"].insert({
    "_id": "4",
    "templateId": "TUTA",
    "result": "Are any of your tires flat or do any of them have visual damages?",
    "date": Date.now(),
    "lastModified": Date.now()
});