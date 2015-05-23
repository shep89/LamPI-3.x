/************* LamPI Node Module **************************************************

Author: M. Westenberg (mw12554@hotmail.com)
LamPI Version:
	3.0.0; Mar 01, 2015; Webserver
	3.0.1; Mar 22, 2015; Rewriting PI-gate for node
	3.0.2; May 10, 2015; Rewriting LamPI-daemon for node

***********************************************************************************	*/
var debug = 1;

var poll_interval =   6000;			// Determine how often we poll the devices for changed values
var log_interval  = 120000;			// Determines how often Z-Wave values are logged in the logfile
var alarm_interval=   2000;			// Determines how often we scan sensors for changed values
var timer_interval=  30000;			// Timer resolution in LamPI timers (crontab) is about 1 minute

var webPort  = 8080;				// The generic http webserver port
var udpPort  = 5001;				// In LamPI-daemon.php this is port 5001
var tcpPort  = 5002;				// Port for net raw tcp connections
var sockPort = 5004;				// In LamPI-daemon.php websockets (gui) this is port 5000

var tcnt = 0;						// transaction counter
var zroot;							// Z-Wave root object (devices is one of its children)
var devices;						// The Z-Wave array of devices
var clients = [];					// Keep track of all connected clients
var loops = [];						// Keep track of running loop id's
var config={};						// This is the overall LamPI configuration array
var lampi_devices;
var lampi_admin=[];

var homeDir = "/home/pi";
var logDir = homeDir+"/log"
var rrdDir = homeDir+"/rrd"
var wwwDir = homeDir+"/www"


// --------------------------------------------------------------------------------
// Put startup require dependencies here
// --------------------------------------------------------------------------------

console.log("Loading http");
var http  = require('http');
console.log("Loading net");
var net   = require('net');						// Raw Sockets Server
console.log("Loading dgram");
var dgram = require("dgram");
console.log("Loading mySQL");
var mysql = require('mysql');
console.log ("Loading express");
var express= require('express');				// Middleware
console.log("Loading Async");
var async = require("async");
console.log("Loading String");
var S     = require("string");
console.log("Loading fs");
var fs    = require("fs");						// Filesystem
console.log("Loading child_process");
var exec  = require('child_process').exec;
console.log     ("Loading serve-static");
var serveStatic= require('serve-static');

// External apps
console.log("Loading required external modules");
var SunCalc = require('suncalc');
var strip = require("strip-json-comments");
// Own modules


console.log("All required code loaded");


// --------------------------------------------------------------------------------
// Logging function
// --------------------------------------------------------------------------------
function logger(txt,lvl) {
	lvl = lvl || debug;
	if (debug >= lvl) {
		var d = new Date();
		var dd =  ("00" + (d.getMonth() + 1)).slice(-2) + "/" + 
			("00" + d.getDate()).slice(-2) + "/" + 
			d.getFullYear() + " " + 
			("00" + d.getHours()).slice(-2) + ":" + 
			("00" + d.getMinutes()).slice(-2) + ":" + 
			("00" + d.getSeconds()).slice(-2);
		console.log("["+dd+"] "+txt);
	}
}

// --------------------------------------------------------------------------------
// COMMAND LINE ARGUMENTS
// --------------------------------------------------------------------------------
process.argv.forEach(function (val, index, array) {
  console.log(index + ': ' + val);
  switch (val) {
	  // init, read config file and make new database
	case "-i":
		var str = "";
		str += 'Suspending '+loops.length+' timers<br>';
		for (var i=0; i<loops.length; i++) clearInterval(loops[i]);
		config = readConfig();
		createDbase(function (err, result) {
			if (err) { logger("init:: ERROR: "+err ); return; }
			logger("init:: createDbase returned "+result,1);
			Object.keys(config).forEach(function(key) {
				logger("createDbase: "+key+", length: "+config[key].length);
				for (k=0; k<config[key].length; k++) {
					str += ''+key+','+k+': '+ config[key][k]['name']+"<br>";
				}
				str += "<br>";
			});
			// nested, as we can start loading once the database is created
			logger("init:: Starting loadDbase");
			loadDbase( function (err, result) { 
				if (err == null) logger("init:: loadDbase returned successful "+result,1);
				lampi_devices = config['devices'];
				Object.keys(config).forEach(function(key) {
					logger("loadDbase: "+key+", length: "+config[key].length);
					for (j=0; j<config[key].length; j++) {
						str += ''+key+','+j+': '+ config[key][j]['name']+"<br>";
					}
					str += "<br>";
				});
				str += '<br>init:: done, restarting loops';
				logger(str,2);						// Can only send results to web client once
				main(0, "init:: Restart Main");
			});
		});
	break;
	case "-r":
		// Only re=read the database
		var str = "";
		for (var i=0; i<loops.length; i++) clearInterval(loops[i]);
		config = readConfig();
		loadDbase( function (err, result) { 
				if (err == null) logger("init:: loadDbase returned successful "+result,1);
				lampi_devices = config['devices'];
				Object.keys(config).forEach(function(key) {
					logger("loadDbase: "+key+", length: "+config[key].length);
					for (j=0; j<config[key].length; j++) {
						str += ''+key+','+j+': '+ config[key][j]['name']+"<br>";
					}
					str += "<br>";
				});
				str += '<br>init:: done, restarting loops';
				logger(str,2);						// Can only send results to web client once
				main(0, "init:: Restart Main");
		});
	break;
	default:
	break;
  }
});

// --------------------------------------------------------------------------------
// EXPRESS middleware
// With help of express we can make routes to separate sections too (and make a REST interface)
// --------------------------------------------------------------------------------
//
var app = express();

// Re-read the database from the init file database.cfg, temporary suspend all loops
// XXX move database.cfg to another location
app.all('/init', function (req, res, next) {
	logger('Accessing the init section ...',1);
	var str = "";
	str += 'init started<br>';
	str += 'Suspending '+loops.length+' timers<br>';
	for (var i=0; i<loops.length; i++) clearInterval(loops[i]);
	config = readConfig();
	createDbase(function (err, result) {
		if (err) { logger("init:: ERROR: "+err ); return; }
		logger("init:: createDbase returned "+result,1);
		Object.keys(config).forEach(function(key) {
			logger("createDbase: "+key+", length: "+config[key].length);
			for (k=0; k<config[key].length; k++) {
				str += ''+key+','+k+': '+ config[key][k]['name']+"<br>";
			}
			str += "<br>";
		});
		// nested, as we can start loading once the database is created
		logger("init:: Starting loadDbase");
		loadDbase( function (err, result) { 
			if (err == null) logger("init:: loadDbase returned successful "+result,1);
			lampi_devices = config['devices'];
			Object.keys(config).forEach(function(key) {
				logger("loadDbase: "+key+", length: "+config[key].length);
				for (j=0; j<config[key].length; j++) {
					str += ''+key+','+j+': '+ config[key][j]['name']+"<br>";
				}
				str += "<br>";
			});
			str += '<br>init:: done, restarting loops';
			logger(str,2);
			res.send(str);							// Can only send results to web client once
			main(0, "init:: Restart Main");
		});
	});

  //next(); // pass control to the next handler
});

// (re)load the database for LamPI.
app.all('/load', function (req, res, next) {
	logger('Accessing the reload section ...',1);
	var str = "";
	str += 'reload started<br>';
	str += 'Suspending '+loops.length+' timers<br>';
  
	for (var i=0; i<loops.length; i++) clearInterval(loops[i]);
	config = readConfig();
  	loadDbase( function (err, result) { 
			if (err == null) logger("load:: loadDbase returned successful "+result,1);
			lampi_devices = config['devices'];
			Object.keys(config).forEach(function(key) {
				logger("load::: "+key+", length: "+config[key].length);
				for (j=0; j<config[key].length; j++) {
					str += ''+key+','+j+': '+ config[key][j]['name']+"<br>";
				}
				str += "<br>";
			});
			str += '<br>load:: done, restarting loops';
			logger(str,2);
			res.send(str);							// Can only send results to web client once
			main(0, "load:: restart Main");
	});
  //next(); // pass control to the next handler
});

//
//
app.all('/weather', function (req, res, next) {
  console.log('Accessing the weather section ...');
  res.send('weather');
  //next(); // pass control to the next handler
});


// --------------------------------------------------------------------------------
// Initiate Filesystem and define related functions
// Read the standard database configuration file and return the config array object
//
function readConfig() {
	var dbCfg = homeDir+"/config/database.cfg";
	var ff = fs.readFileSync(dbCfg, 'utf8');
	var obj = JSON.parse(strip(ff));
	if (debug>=3) { logger("readConfig:: config read: ",3); console.log(obj); }
	return(obj);
}

// ============================================================================
// CURL: How to call (curl style) the Z-Wave JS API?
//	We can do this to retrieve the configuration of Z-Wave 
//	The http request can be called multiple times
// ----------------------------------------------------------------------------
//  

// For ALL Z-Wave data, the URL must end with 0
function zwave_init (cb) {
	var zwave_init_options = {
		host: '192.168.2.52',
		path: '/ZWaveAPI/Data/0',
		port: '8083',
		method: 'GET',
		headers: { 'Content-Type': 'application/json' }
	};
	// Get ALL data from the Zwave controller and put in zroot!
	var zwave_init_cb = function(response) {
		var str = '';
		//another chunk of data has been recieved, so append it to `str`
  		response.on('data', function (chunk) {
    		str += chunk;
		});
		response.on('end', function () {
    		if (debug>=3) console.log(str);
			zroot = JSON.parse(str);
			devices = zroot.devices;
			logger("Successfully read Z-Wave Data, #devices: "+Object.keys(devices).length,1);
			cb(null,"zwave_init done");
  		});
	}
	http.request(zwave_init_options, zwave_init_cb).end();
}


// For GETting data changed from a certain moment
var zwave_upd_options = {
	host: '192.168.2.52',
	path: '/ZWaveAPI/Data/'+(Math.floor(Date.now()/1000) - alarm_interval),
	port: '8083',
	method: 'GET',
	headers: { 'Content-Type': 'application/json' }
};

// Get ONLY updates drom the ZWave controller
var zwave_upd_cb = function(response) {
	var str = '';
	//another chunk of data has been recieved, so append it to `str`
  	response.on('data', function (chunk) {
    	str += chunk;
	});
	response.on('end', function () {
    	if (debug>=3) console.log(str);
		var js = JSON.parse(str);
		Object.keys(js).forEach(function(key) {
			var pobj = zroot;							// XXX Zroot MUST have been initialize before					 
			var pe_arr = key.split('.');
			for (var pe in pe_arr.slice(0, -1)) {
                	pobj = pobj[pe_arr[pe]];
            };
			pobj[pe_arr.slice(-1)] = js[key];
		});
		logger("Successfully read the Z-Wave Data stucture, Read "+ Object.keys(js).length +" records",2);
  	});
}

// ================================================================================
// BROADCAST Send a message to all clients/sockets
// Make sure that broadcasts are timed so that there be no collissions of transmissions
// and each broadcast to slaves is dealt with correctly
// --------------------------------------------------------------------------------
function broadcast(message, sender) {	// MMM
	logger("broadcast:: message: "+message, 2);
	var funcs = [];
	var args  = [];
	// If you don't want to send back to sender, such as sensors
	// At the moment we need broadcast to confirm actions to the initiating GUI
	clients.forEach(function (client) {

	  args.push (client);
	  funcs.push( function(callback) { 				// Push the function code for later use
		setTimeout(function() {
			var cl = args.shift();
			if ((cl !== sender) || ( cl.type == "ws" )) {
		  		switch (cl.type) {
				case "raw":
					logger("Broadcast to Rawsocket: "+cl.name,2);
					if (cl.write(message) != true) {
						logger("broadcast:: raw socket error",1);
						callback("broadcast raw error" , null)
					}
					else {
						logger("bcst :: raw client: "+cl.name,3);
						callback(null, cl.name);
					}
				break;
				case "ws":
					cl.send(message, function ack(error) {
						if (error) { 
							logger("broadcast:: ws send error: "+error,1); 
							callback(error, null) 
						}
						else {
							logger("bcst :: web client: "+cl.name,3);
							callback(null, cl.name);
						}
					});
				break;
				default:
					logger("broadcast:: unknown type: "+cl.type,2);
					callback("broadcast:: Unknown type: "+cl.type, null);
				break;
		  		}//switch
				//callback("broadcast:: Error Unknown type: "+cl.type, null);
			}//if
		}, 400);//setTimeout
	  });// funcs
	});// forEach
	
	async.series(funcs, function(err, results) {
		if (err) logger("broadcast:: ERROR ERROR: "+err,1);
		else logger("broadcast:: finished, results: "+results,2);
	});
	return;
}

// --------------------------------------------------------------------------------
// RAW SOCKET Server, listen for incoming connections
// The TCP server below defines the actual listening address
// --------------------------------------------------------------------------------
//
var HOST = "0.0.0.0";

var server = net.createServer(function(socket) { //'connection' listener									  
	// Upon incoming request
	socket.name = socket.remoteAddress + ":" + socket.remotePort;
	socket.type = "raw";
	logger('SOCKET:: socket server connected to: '+socket.name,1);
	clients.push(socket);								// Put this new client in the list
	socket.on('end', function() {						// End of connection
		logger("SOCKET:: socket server "+socket.name+" disconnected",1);
		clients.splice(clients.indexOf(socket), 1);
	});
	socket.on('text', function(txt) {
		logger('SOCKET:: socket server received text: '+txt,1);
	});
	socket.on('data', function(data) {				// This function is calld when receiving data from sensors
		logger("SOCKET:: socket data received: "+ data, 2);
		//socket.write(200,{ 'Content-Type': 'text/html' });
		socketHandler(data,socket);
	});
	socket.on('message', function(data) {
		logger("SOCKET:: socket message received: "+ data,2);
		//socket.write(200,{ 'Content-Type': 'text/html' });
		socketHandler(data,socket);
	});
	socket.on('upgrade', function(request, sock, head) {
		logger("SOCKET:: socket upgrade received: "+ request,1);
		var data = {
			tcnt: 868,
			type: "json",
			action: "alarm",						// actually the class of the action
			scene: "",								// Scene name to be executed
			message: "NODE ALARM"					// Message to popup in 
		};
		var ret = sock.write(JSON.stringify(data));
	});
	socket.on('connect', function() {
		logger("SOCKET:: socket Connection Established ",1);
	});
});

server.listen(tcpPort, HOST, function() { 			//'listening' listener							   
	logger('TCP server listening to addr:port: '+HOST+":"+tcpPort);
});


// ----------------------------------------------------------------------------
// WEBSOCKET SERVER
//		Here we receive the messages from the GUI
// ----------------------------------------------------------------------------
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: sockPort});
wss.on('connection', function(ws) {
	//console.log("WS:: socket connected: ", ws);
	ws.name = ws.upgradeReq.headers.origin;			// In general the address and port of our webserver
	ws.type = "ws";									// Add the type ws (websocket)
	clients.push(ws);								// Put this new client in the list
	ws.on('message', function(message) {
		if (debug >=2) console.log('WS received: %s', message);
		socketHandler(message, ws);
	});
	// ws.send('ping');
	ws.on('close',function() {
		logger("WS:: socket "+ws.name+" disconnected",1);
		clients.splice(clients.indexOf(ws), 1);
	});
}); 

// ----------------------------------------------------------------------------
// UDP Server
// Bind to a well known address and listen to incoming DGRAM messages
// ----------------------------------------------------------------------------
//
var userver = dgram.createSocket("udp4");

userver.on("error", function (err) {
  console.log("UDP server error:\n" + err.stack);
  userver.close();
});
userver.on("message", function (msg, rinfo) {
  logger("UDP message from " + rinfo.address + ":" + rinfo.port,2);
  logger("UDP server  msg: " + msg,3);
  rinfo.name = rinfo.address + ":" + rinfo.port;
  rinfo.type = "udp"
  socketHandler(msg, rinfo);
});
userver.on("listening", function () {
  var address = userver.address();
  logger("UDP server listening to addr:port: " + address.address + ":" + address.port,1);
});

userver.bind(udpPort);

// ============================================================================
// NODE_MYSQL: How to call database functions
// 	The call to the database is used to retrieve the list of devices used by LamPI
// 	In principle we do this once (and may be repeated to get the device
//	definitions and address to name translation for Z-Wave devices in our
//	network
// ----------------------------------------------------------------------------
//
var connection = mysql.createConnection({
  host     : '192.168.2.11',
  user     : 'coco',
  password : 'coco',
  database : 'dorm'
});

function connectDbase(cbk) {
	connection.connect(function(err) {
	// connected! (unless `err` is set)
		if (!err) {
			logger("Connected to the MySQL Database",1);
			cbk(null, "mysql connected");
		}
		else {
			logger("ERROR:: Connecting to the MySQL Database",1);
			cbk("connectDbase error","null");
		}
	});
}

// ----------------------------------------------------------------------------
// Perform a single SELECT query, and  callback function
// ----------------------------------------------------------------------------
function queryDbase(qry,cbk) {
  var query = connection.query(qry, function(err, rows, fields) {
	if (!err) {
		if (debug >= 3) { console.log('queryDbase:: is: \n', rows); }
		cbk(null, rows);
	}
	else {
		console.log('queryDbase:: err: '+err+', query: <'+query.sql+">");
		cbk("queryDbase err: "+err,null);
	}
  });
}


// ----------------------------------------------------------------------------
// Insert in DB
// ----------------------------------------------------------------------------
function insertDb(table, obj, cbk) {
	var query = connection.query('INSERT INTO '+table+' SET ?', obj, function(err, result) {
  		if (!err) {
  			if (debug >= 3) { console.log('insertDb success:: result: \n', result); }
			cbk(null,result);
  		}
		else {
			console.log('insertDb:: err: '+err+', query ',query.sql);
			cbk("Error: "+err,null);
		}
  	});	
}


// ----------------------------------------------------------------------------
// update in DB
// ----------------------------------------------------------------------------
function updateDb(table, obj, cbk) {
	var query = connection.query('UPDATE '+table+' SET ? WHERE id=?', [ obj, obj.id ], function(err, result) {
  		if (!err) {
  			if (debug >= 3) { console.log('updateDb success:: result: \n', result); }
			cbk(null,result);
  		}
		else {
			console.log('updateDb:: err: '+err+', query ',query.sql);
			cbk(err,result);
		}
  	});	
}

// ----------------------------------------------------------------------------
// Delete item in DB, based on correct id
// ----------------------------------------------------------------------------
function deleteDb(table, obj, cbk) {
	var query = connection.query('DELETE FROM '+table+' WHERE id=?', obj.id, function(err, result)  {
  		if (!err) {
  			if (debug >= 3) { console.log('deleteDb success:: result: \n', result); }
			cbk(null,result);
  		}
		else {
			console.log('deleteDb:: err: '+err+', query ',query.sql);
			cbk(err,result);
		}
  	});	
}


// ----------------------------------------------------------------------------
// Delete Device(!) in DB, based on correct room and id
// ----------------------------------------------------------------------------
function delDevDb(table, obj, cbk) {
	//var kk = Object.keys(obj);		// id, unit, gaddr, room, name, type, val, lastval, brand
	//var vv = "";
	//Object.keys(obj).forEach(function(key) {vv +=obj[key]+","; });
	var query = connection.query('DELETE FROM '+table+' WHERE id=? and room=?', [ obj.id, obj.room ], function(err, result)  {
		//logger("delDevDb:: query: "+query);
  		if (!err) {
  			if (debug >= 3) { console.log('deleteDb success:: result: \n', result); }
			cbk(null,result);
  		}
		else {
			console.log('updateDbe:: err: '+err+', query ',query.sql);
			cbk(err,result);
		}
  	});	
}

// ----------------------------------------------------------------------------
// update Device(!) in DB
// ----------------------------------------------------------------------------
function updDevDb(table, obj, cbk) {
	var query = connection.query('UPDATE '+table+' SET ? WHERE id=? AND room=?', [ obj, obj.id, obj.room], function(err, result) {
  		if (!err) {
  			if (debug >= 3) { console.log('updDevDb success:: result: \n', result); }
			cbk(null,result);
  		}
		else {
			console.log('updateDbe:: err: '+err+', query ',query.sql);
			cbk(err,result);
		}
  	});	
}

// ----------------------------------------------------------------------------
// Create Database, belongs to init function
// ----------------------------------------------------------------------------
function createDbase(cb) {
	
  async.series([
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS rooms',function(err, ret) { 
		queryDbase('CREATE TABLE rooms(id INT, descr CHAR(128), name CHAR(20) )', function(err, ret) {
			callback(err,'rooms made, sizeof rooms is:  '+config['rooms'].length);
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS devices',function(err, ret) { 
		queryDbase('CREATE TABLE devices(id CHAR(3), descr CHAR(128), uaddr CHAR(3), gaddr CHAR(12), room CHAR(12), name CHAR(20), type CHAR(12), val INT, lastval INT, brand CHAR(20) )',function(err, ret) {																																	
			callback(err,'devices made, sizeof rooms is: '+config['rooms'].length);
		});
	});
  },
  function(callback) {
	queryDbase('DROP TABLE IF EXISTS scenes',function(err, ret) { 
		queryDbase('CREATE TABLE scenes(id INT, descr CHAR(128), val INT, name CHAR(20), seq CHAR(255) )',function(err, ret) {
			callback(err,"scenes made, sizeof rooms is: "+config['rooms'].length);
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS timers',function(err, ret) { 
		queryDbase('CREATE TABLE timers(id INT, descr CHAR(128), name CHAR(20), scene CHAR(20), tstart CHAR(20), startd CHAR(20), endd CHAR(20), days CHAR(20), months CHAR(20), skip INT )',function(err, ret) {
			logger("createDB timers, sizeof rooms is: "+config['rooms'].length);
			callback(err,'timers made');
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS handsets',function(err, ret) { 
		queryDbase('CREATE TABLE handsets(id INT, descr CHAR(128), name CHAR(20), brand CHAR(20), addr CHAR(20), unit INT, val INT, type CHAR(20), scene CHAR(255) )',function(err, ret) {
			callback(null,'handsets made');
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS settings',function(err, ret) { 
		queryDbase('CREATE TABLE settings(id INT, descr CHAR(128), val CHAR(128), name CHAR(20) )',function(err, ret) {
			callback(null,'settings made');
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS controllers',function(err, ret) { 
		queryDbase('CREATE TABLE controllers(id INT, descr CHAR(128), name CHAR(20), fname CHAR(128) )',function(err, ret) {
			callback(null,'controllers made');
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS brands',function(err, ret) { 
		queryDbase('CREATE TABLE brands(id INT, descr CHAR(128), name CHAR(20), fname CHAR(128) )',function(err,ret) {
			callback(null,'brands made');
		});
	});
  },
  function (callback) {
	queryDbase('DROP TABLE IF EXISTS weather',function(err, ret) { 
		queryDbase('CREATE TABLE weather(id INT, descr CHAR(128), name CHAR(20), location CHAR(20), brand CHAR(20), address CHAR(20), channel CHAR(8), temperature CHAR(8), humidity CHAR(8), airpressure CHAR(8), windspeed CHAR(8), winddirection CHAR(8), rainfall CHAR(8), luminescence CHAR(8) )',function(err,ret) {
			logger("createDB weather, sizeof rooms is: "+config['rooms'].length);
			callback(null,'weather made');
		});
	});
  },
  function (callback) { var r = [];
	logger("createDb starting for devices, #devices: "+config['devices'].length);
	for (var i=0; i< config['devices'].length; i++) { 
		insertDb("devices", config['devices'][i], function(err,result) { r.push("d"); }); }
	callback(null, 'devices: '+r);
  },
  function (callback) { var r = [];
	logger("createDb starting for rooms, #rooms: "+config['rooms'].length);
	for (var i=0; i< config['rooms'].length; i++) { 
		//logger("createDb:: inserting: "+config['rooms'][i]['name']);
		insertDb("rooms", config['rooms'][i], function(cb) { r.push("r") }); }
	callback(null, 'fill rooms'+config['rooms'].length);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['scenes'].length; i++) { 
		insertDb("scenes", config['scenes'][i], function(cb) { r.push("s"); }); }
	callback(null, 'scenes: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['timers'].length; i++) { 
		insertDb("timers", config['timers'][i], function(cb) { r.push("t"); }); }
	callback(null, 'timers: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['handsets'].length; i++) { 
		insertDb("handsets", config['handsets'][i], function(cb) { r.push("h"); }); }
	callback(null, 'handsets: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['settings'].length; i++) { 
		insertDb("settings", config['settings'][i], function(cb) { r.push("x") }); }
	callback(null, 'settings: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['controllers'].length; i++) { 
		insertDb("controllers", config['controllers'][i], function(cb) { r.push("c"); }); }
	callback(null, 'controllers: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['brands'].length; i++) { 
		insertDb("brands", config['brands'][i], function(cb) { r.push("b"); }); 	}
	callback(null, 'brands: '+r);
  },
  function (callback) { var r = [];
	for (var i=0; i< config['weather'].length; i++) { 
		insertDb("weather", config['weather'][i], function(cb) { r.push("w"); }); 	
	}
	callback(null, 'weather: '+r);
  }
  ], 
  function (err, result) { 
  	if (err) { 
		logger("createDbase:: ERROR: "+err); 
		cb(err,result);
	}
  // Now the databases are created, we can read the database.cfg file, JSON.parse
	else {
  		logger("createDbase:: Databases created, result: ",1); console.log(result);
		cb(null,result);
	}
  });
}

// ----------------------------------------------------------------------------
// LOAD DATABASE
// ----------------------------------------------------------------------------
function loadDbase(db_callback) {
  async.series([			  
	function(callback) {
	  queryDbase('SELECT * from devices',function(err, dev) { 
		config['devices']=dev; 
		lampi_devices = config['devices'];  
		for (var i=0; i< lampi_devices.length; i++) {				// Init the lampi_admin array
			if (lampi_devices[i]['gaddr'] == "868") {				// Is this a Z-Wave device
				var rec = {											// Make sure every rec is defined only once
					val: lampi_devices[i]['val'],
					checks: 3
				}
				var unit = lampi_devices[i]['uaddr'];
				lampi_admin[unit] = rec;
			}//if 868
		}//for
		callback(null,'devices '+dev.length);
	  });
	},
	// Do the CURL request to Z-Wave to load the devices data
	function(callback) {
		queryDbase('SELECT * from rooms',function cbk(err, arg) { 
			config['rooms']=arg; callback(null,'rooms '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from scenes',function cbk(err, scn) { 
			config['scenes']=scn; callback(null,'scenes '+scn.length); });
	},
	function(callback) {
		queryDbase('SELECT * from timers',function cbk(err, arg) { 
			config['timers']=arg; callback(null,'timers '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from settings',function cbk(err, arg) { 
			config['settings']=arg; callback(null,'settings '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from brands',function cbk(err, arg) { 
			config['brands']=arg; callback(null,'brands '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from handsets',function cbk(err, arg) { 
			config['handsets']=arg;callback(null,'handsets '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from weather',function cbk(err, arg) { 
			config['weather']=arg; callback(null,'weather '+arg.length); });
	},
	function(callback) {
		queryDbase('SELECT * from controllers',function cbk(err, arg) { 
			config['controllers']=arg; callback(null,'controllers '+arg.length); });
	}
], function(err, result) { 
		// logger("database read: ",1); console.log(lampi_devices);
		db_callback(null, result) 
  });	
}


// --------------------------------------------------------------------------------
// Options for Setting Z-Wave values
//  ldev is the index in the LamPI device array
//	val is the new value for this devices
//	zdev is the index in the zway device structure
// --------------------------------------------------------------------------------
function deviceSet (ldev, val) {
	var zdev = lampi_devices[ldev]['uaddr'];
	var type = lampi_devices[ldev]['type'];
	var zval = Math.floor( val * 99 / 32) ;
	var opt4set = {
		host: '192.168.2.52',
		path: '',
		port: '8083',
		method: 'GET',
		headers: { 'Content-Type': 'application/json' }
	};
	callSet = function(response) {
		response.on('data', function (chunk) {		
			logger("WARNING deviceSet received data: "+chunk, 2);
		});
		response.on('end', function () {
			logger("deviceSet has ended",2);
		});
		response.on('error', function () {
			logger("deviceSet ERROR Updating dev: "+zdev+"", 1);
  		});
	}
	switch (type) {
		case "dimmer":
			opt4set.path = '/ZWaveAPI/Run/devices['+zdev+'].instances[0].commandClasses[38].Set('+zval+')';
		break;
		case "switch":
			opt4set.path = '/ZWaveAPI/Run/devices['+zdev+'].instances[0].commandClasses[37].Set('+zval+')';
		break;
		case "thermostat":	// data 1 is set point
			opt4set.path = '/ZWaveAPI/Run/devices['+zdev+'].instances[0].commandClasses[67].ThermostatSetPoint.Set(1,'+zval+')';
		break;
		default:
			logger("deviceSet:: Unknown type "+type);
		break
	}
	// Call the function
	http.request(opt4set, callSet).end();
	lampi_admin[zdev]['val'] = val;								// Update the admin array asap
}

// --------------------------------------------------------------------------------
//	DeviceGet
//	Make sure that we have the latest value of the device in our Z_Wave data structure
//	The dev parameter defines the device that we like to update 
// ldev is index of device in LamPI devices array
// --------------------------------------------------------------------------------
//
function deviceGet(ldev,ltype) {
	
	var dev  = lampi_devices[ldev]['uaddr'];		// LamPI Device
	var lVal = lampi_devices[ldev]['val'];		// LamPI gui value
	var aVal = lampi_admin[dev]['val'];			// This array is indexed like the Z-Way(!!!) devices[] array
	var newVal, lastUpdate, inValid;
	var opt4get = {
		host: '192.168.2.52',
		path: '/ZWaveAPI/Run/devices['+dev+'].Basic.Get()',
		port: '8083',
		method: 'GET',
		headers: { 'Content-Type': 'application/json' }
	};
	var callget = function(response) {
		// In principle this function does not return anything
  		response.on('data', function (chunk) {		
			logger("ERROR deviceGet received data: "+chunk, 3);
		});
		//the whole response has been recieved, so we just print it out here
		response.on('end', function () {
			logger("deviceGet:: device: "+dev+", lampi dev index: "+ldev, 2);
			// If new value <> old value --->> Change 
			// And If new value <> LamPI-value -->> Update LamPI, we have a manual change
			switch (ltype) {
				case "switch": 
					if (devices[dev].instances[0].commandClasses[37].data.interviewDone.value == false) {
						console.log("ERROR:: Switch device "+dev+" Dead");
						return;
					}
					newVal = devices[dev].instances[0].commandClasses[37].data.level.value + 0;
					lastUpdate = devices[dev].instances[0].commandClasses[37].data.level.updateTime +0;
					inValid = devices[dev].instances[0].commandClasses[37].data.level.invalidateTime +0;
				break;
				case "dimmer":
					if (devices[dev].instances[0].commandClasses[38].data.interviewDone.value === false) {
						console.log("ERROR:: Dimmer device "+dev+" Dead");
						return;
					}
					newVal = Math.ceil(devices[dev].instances[0].commandClasses[38].data.level.value/99*32);
					lastUpdate = devices[dev].instances[0].commandClasses[38].data.level.updateTime + 0;
					inValid = devices[dev].instances[0].commandClasses[38].data.level.invalidateTime + 0;
				break;
				case "thermostat":
					if (devices[dev].instances[0].commandClasses[67].data.interviewDone.value === false) {
						logger("ERROR:: Thermostat device "+dev+" Dead",2);
						return;
					}
					newVal = devices[dev].instances[0].commandClasses[67].data[1].val.value;
					lastUpdate = devices[dev].instances[0].commandClasses[67].data[1].val.updateTime;
					inValid = devices[dev].instances[0].commandClasses[67].data[1].val.invalidateTime;
					return;
				break;
				default:
					logger("ERROR lampi type not supported: "+ltype);
					return;
				break;
			}// switch
			logger("Dev: "+dev+", lVal: "+lVal+", aVal: "+aVal+", zVal: "+newVal,2);
			
			// The Z-Wave newVal, the LamPI lVal and the administratie value are equal
			if (( newVal == lVal ) && ( aVal == lVal )) { 	
				logger ("X X X, all values of device "+dev+" are equal",3);
				return;
			}
			// The Z-Wave newVal and the LamPI lVal both changed are the LamPI admin value needs updating
			else if (( newVal == lVal ) && ( aVal != lVal )) { 
				logger ("Y X Y, updating device "+dev+" to zVal: "+newVal,1);
				lampi_admin[dev]['val'] = newVal;				
				// XXX Do we need to update the LamPI database?
			}
			// The LamPI gui value lVal is different from the administrative value and Z-Wave measured value newVal
			else if (( newVal != lVal ) && ( aVal == newVal )) { 
				logger("Y X X, The gui valui of "+dev+" has changed",1);
				lampi_devices[ldev]['val'] = newVal;						// Change value in working array
				updDevDb("devices", lampi_devices[ldev], function(cbk) { 
						logger("deviceGet:: store_device "+dev+" finished OK",1); });
				// prepare a broadcast message for all connected gui's
				var ics = "!R"+lampi_devices[ldev]['room']+"D"+dev+"F";
				if (newVal == 0) ics = ics+"0";
				else ics = ics + "dP" + newVal;
				var data = {
					tcnt: ""+tcnt++ ,
					type: "json",
					action: "gui",				// actually the class of the action
					cmd: "zwave",
					gaddr: "868",
					uaddr: ""+dev,
					val: ""+newVal,
					message: ics	
				};
				logger("deviceGet:: to broadcast: "+JSON.stringify(data),1);
				var ret = broadcast(JSON.stringify(data), null);	
			}
			// The Z-Wave value newVal has changed (human touch) and the LamPI lVal and administrative value
			// need updating to this change
			else if (( newVal != lVal ) && ( aVal == lVal ))						  
			{
				logger("X X Y, Z-Wave changed; Update lampi gui for device "+dev+" to value "+newVal,1);
				var data = {
							tcnt: ""+tcnt++ ,
							type: "raw",
							action: "gui",				// actually the class of the action
							cmd: "zwave",
							gaddr: "868",
							uaddr: ""+dev,
							val: ""+newVal,
							message: "!R"+lampi_devices[ldev]['room']+"D"+dev+"F"+newVal	// switch
				};
				switch (ltype) {
					case "switch":
						data.message = "!R"+lampi_devices[ldev]['room']+"D"+dev+"F"+newVal;
					break;
					case "dimmer":
						data.message = "!R"+lampi_devices[ldev]['room']+"D"+dev+"FdP"+newVal ;	// Message parameter(s) ICS code
					break;
					default:
						logger("No Manual Update Action defined");
					break;
				}//switch
				logger("Sending data to broadcast: "+JSON.stringify(data),2);
				var ret = broadcast(JSON.stringify(data) );
				lampi_admin[dev]['val'] = newVal;
				logger("Updated dimmer to "+newVal+", cmd string: "+data.message);
			}//if laval != zval
			else {
				logger("Y X Z, reset admin for device "+dev+" to lampi defined value "+lVal,1);
				lampi_admin[dev]['val'] = lVal;
			}
  		});//.on end
		response.on('error', function () {
    		//console.log(str);
			logger("ERROR Updating dev: "+dev+"", 1);
  		});
		response.on('timeout', function () {
  		// Timeout happened. Server received request, but not handled it
  		// (i.e. doesn't send any response or it took to long). You don't know what happend.
  		// It will emit 'error' message as well (with ECONNRESET code).
  			logger("deviceGet:: TIMEOUT");
  			response.abort();						// XXX This may be just too much
		});
		response.setTimeout(5000);
	}
	// Call the function
	http.request(opt4get, callget).end();
}

// --------------------------------------------------------------------------------
//	TIME Functions, get the time in string format or as ticks
// --------------------------------------------------------------------------------
//
function getTime() {
	var date = new Date();
	return S(date.getHours()).padLeft(2,'0').s+ ':' +S(date.getMinutes()).padLeft(2,'0').s+ ':' +S(date.getSeconds()).padLeft(2,'0').s ;
}

function getTicks() {
	//var date = new Date();
	return (Math.floor(Date.now()/1000));
}

function printTime(t) {
	var date = new Date(t);
	return S(date.getHours()).padLeft(2,'0').s+ ':' +S(date.getMinutes()).padLeft(2,'0').s+ ':' +S(date.getSeconds()).padLeft(2,'0').s ;
}


// --------------------------------------------------------------------------------
// Function returns an index to the devices or scenes in the config array
// --------------------------------------------------------------------------------
function findDevice (room, uaddr) {
	logger("findDevice:: length: "+lampi_devices.length+", room: "+room+", uaddr: "+uaddr,2);
	var i;
	for (i=0; i < lampi_devices.length; i++) {
		if ((lampi_devices[i]['room'] == room ) && (lampi_devices[i]['uaddr'] == uaddr )) {
			break;
		}
	}
	if (i < lampi_devices.length) return(i);
	return(-1);
}

function idDevice (room, id) {
	logger("findDevice:: length: "+lampi_devices.length+", room: "+room+", id: "+id,2);
	var i;
	for (i=0; i < lampi_devices.length; i++) {
		if ((lampi_devices[i]['room'] == room ) && (lampi_devices[i]['id'] == id )) {
			break;
		}
	}
	if (i < lampi_devices.length) return(i);
	return(-1);
}

function gaddrDevice (gaddr, uaddr) {
	logger("gaddrDevice:: length: "+lampi_devices.length+", gaddr: "+gaddr+", uaddr: "+uaddr,2);
	var i;
	for (i=0; i < lampi_devices.length; i++) {
		if ((lampi_devices[i]['gaddr'] == gaddr ) && (lampi_devices[i]['uaddr'] == uaddr )) {
			break;
		}
	}
	if (i < lampi_devices.length) return(i);
	return(-1);
}

function findScene (name) {
	var i;
	for (i=0; i < config['scenes'].length; i++) {
		if (config['scenes'][i]['name'] == name ) {
			break;
		}
	}
	if (i < config['scenes'].length) return(i);
	return(-1);
}

function addrSensor (address, channel) {
	logger("addrSensor:: length: "+config['weather'].length+", address: "+address+", channel: "+channel,2);
	var i;
	for (i=0; i < config['weather'].length; i++) {
		if ((config['weather'][i]['address'] == address ) && (config['weather'][i]['channel'] == channel )) {
			break;
		}
	}
	if (i < config['weather'].length) return(i);
	return(-1);
}

// --------------------------------------------------------------------------------
// Delete a value based on id !! from the (config) array
function delFromArray (arr, element) {
	var i;
	for (i=0; i<arr.length; i++) {
		if (arr[i]['id'] == element['id'] ) break;
	}
	arr.splice(i,1);
}

// --------------------------------------------------------------------------------
// Update a value in the (config) array based on id !! 
function updFromArray (arr, element) {
	var i;
	for (i=0; i<arr.length; i++) {
		if (arr[i]['id'] == element['id'] ) { arr[i] = element; break; }
	}
}

// --------------------------------------------------------------------------------
// ALLOFF handling
//	Switch all devices in room 'room' off
//	Use async serial to assure synchronized execution of broadcasts with 2 sec interval
// --------------------------------------------------------------------------------
function allOff(room, socket) {
	var series =[];
	var str=[];
	for (var i=0; i<lampi_devices.length; i++) {
		if (lampi_devices[i]['room'] == room) {
			var brandi = lampi_devices[i]['brand'];
			var data = {
				tcnt: ""+tcnt++ ,
				type: "raw",
				action: "gui",								// actually the class of the action
				cmd: config['brands'][brandi]['fname'],
				gaddr: ""+lampi_devices[i]['gaddr'],
				uaddr: ""+lampi_devices[i]['uaddr'],
				val: "0",
				message: "!R"+room+"D"+lampi_devices[i]['uaddr']+"F0"
			};
			str.push(JSON.stringify(data));					// The message array that must survive async operation
			series.push( function(callback) { 				// Push the function code for later use
				setTimeout( function(){ 
					var msg = str.shift();
					logger("allOff:: timeout str: "+msg); 
					broadcast(msg, socket); 
					callback(null, "yes"); 
				}, 2000); 
			});
			if (lampi_devices[i]['gaddr'] == "868" ) deviceSet(i, "0");	// zwave only
		}
	}
	// Now call the execution
	async.series(series, function(err, results) {
		if (err) logger("allOFF:: ERROR ERROR: "+err,1);
		else logger("allOff:: OKE OKE  finished, results: "+results,2);
	});
	return;
}

// --------------------------------------------------------------------------------
// ALARM Handler
// --------------------------------------------------------------------------------
function alarmHandler(buf, socket) {
	logger("alarmHandler:: buf: "+buf,1);
	
}

// --------------------------------------------------------------------------------
// CONSOLE Handler
// --------------------------------------------------------------------------------
function consoleHandler(request, socket) {
	logger("consoleHandler:: request: "+request,1);
	var list="";					// Conrains response string with html newline <br> added
	switch (request) {
		case "logs":
			exec('tail -30 /home/pi/log/PI-node.log', function (error, stdout, stderr) {
			//exec('ls www/styles', function (error, stdout, stderr) {
				if (error === null) { list += stdout.split("\n").join("<br>") + "<br><br>" + stderr; }
				else  { list += "<br>  CONSOLE ERROR:   "+ error + "     <br>  " + stderr; }
				var response = {
					tcnt: ""+tcnt++,
					type: 'raw',
					action: 'console',
					request: request,
					response: list
				};
				var ret = socket.send(JSON.stringify(response));
			});
			return;
		break;
		case "zlogs":
			// TBD
		break;
		case "sunrisesunset":
			var times = SunCalc.getTimes(new Date(), 51.5, -0.1);
			var sunriseStr = times.sunrise.getHours() + ':' + times.sunrise.getMinutes();
			var sunsetStr = times.sunset.getHours() + ':' + times.sunset.getMinutes();
			list = "Sunrise: "+sunriseStr+"\nSunset: "+sunsetStr;
		break;
		case "clients":
			logger("Active socket Clients:: ",1);
			list = "<br>";
			clients.forEach(function (client) {
				list += client.name + " : " + client.type + "    <br>";
			});
		break;
		case "rebootdaemon":
			list="<br>Rebooting Node Daemon Now<br><br>this will take a minute<br>";
			setTimeout(function(){
				exec('nohup /home/pi/scripts/PI-node -r &', function (error, stdout, stderr) {
				});
			}, 2000);
		break;
		default:
			logger("consoleHandler:: Unknown request: "+request);
			list = "Unknown request<br>";
		break;
	}
	var response = {
		tcnt: ""+tcnt++,
		type: 'raw',
		action: 'console',
		request: request,
		response: list
	};
	var ret = socket.send(JSON.stringify(response));
}

// --------------------------------------------------------------------------------
// DBASE Handler
// --------------------------------------------------------------------------------
function dbaseHandler(cmd, args, socket) {
	logger("dbaseHandler:: cmd: "+cmd, 1);
	if(debug >= 2) {
		logger("dbaseHandler:: cmd: "+cmd+", args: ", 2);
		console.log(args);
	}
	switch (cmd) {
		case 'add_room':					//  a new room
			insertDb("rooms", args, function(result) { logger("add_room finished OK "+result,1); });
			config['rooms'].push(args);
		break;
		case 'delete_room':
			deleteDb("rooms", args, function(result) { logger("delete_room finished OK "+result,1); });
			delFromArray(config['rooms'],args);
		break;
		case 'add_scene':
			insertDb("scenes", args, function(result) { logger("add_scene finished OK "+result,1); });
			config['scenes'].push(args);
		break;
		case 'delete_scene':
			deleteDb("scenes", args, function(result) { logger("delete_scenes finished OK "+result,1); });
			delFromArray(config['scenes'],args);
		break;
		case 'store_scene':					// Process updated scene
			updateDb("scenes", args, function(result) { logger("store_scenes finished OK "+result,1); });
			updFromArray(config['scenes'],args);
		break;
		case 'add_timer':
			insertDb("timers", args, function(result) { logger("add_timer finished OK "+result,1); });
			config['timers'].push(args);
		break;
		case 'delete_timer':
			deleteDb("timers", args, function(result) { logger("delete_timers finished OK "+result,1); });
			delFromArray(config['timers'],args);
		break;
		case 'store_timer':
			updateDb("timers", args, function(result) { logger("store_timers finished OK "+result,1); });
			updFromArray(config['timers'],args);
		break;
		case 'add_handset':
			insertDb("handsets", args, function(result) { logger("add_handset finished OK "+result,1); });
			config['handsets'].push(args);
		break;
		case 'delete_handset':
			deleteDb("handsets", args, function(result) { logger("delete_handsets finished OK "+result,1); });
			delFromArray(config['handsets'],args);
		break;
		case 'add_weather':
			insertDb("weather", args, function(result) { logger("add_weather finished OK "+result,1); });
			config['weather'].push(args);
		break;
		case 'delete_weather':
			deleteDb("weather", args, function(result) { logger("delete_weather finished OK "+result,1); });
			delFromArray(config['weather'],args);
		break;
		case 'store_setting':
			updateDb("settings", args, function(result) { logger("store_settings finished OK "+result,1); });
			updFromArray(config['settings'],args);
			if (args['name'] == "debug") debug = Number(args['val']);
		break;
		
		// Devices are special, they do not have one unique key, but need room + id to make unique
		case 'add_device':
			insertDb("devices", args, function(result) { logger("add_device finished OK",1); });
			config['devices'].push(args);
		break;
		case 'delete_device':
			delDevDb("devices", args, function(result) { logger("delete_device finished OK",1); });
			var i = idDevice(args.room, args.id);
			if (i != -1) config['devices'].splice(i,1);
			else logger("dbaseHandler:: delete_device failed for index: "+i+", room: "+args.room+", id: "+args.id);
		break;
		case 'store_device':
			updDevDb("devices", args, function(result) { logger("store_device finished OK",1); });
			var i = idDevice(args.room, args.id);
			if (i != -1) config['devices'][i] = args;
			else logger("dbaseHandler:: store_device failed for index: "+i);
		break;
		default:
			logger("dbaseHandler:: Unknown command: "+cmd,1);
		break;
	}
}

// --------------------------------------------------------------------------------
// ENERGY Handler RRDTOOL based
// Buf is an object with a standard set of fields
// --------------------------------------------------------------------------------
function createEnergyDb (db, buf, socket) {
	var str=[];
	logger("createEnergyDb:: ",1);
	
	str += ((buf['kw_hi_use'] !== undefined) ? "DS:kw_hi_use:COUNTER:600:0:999999999 " : "");
	str += ((buf['kw_lo_use'] !== undefined) ? "DS:kw_lo_use:COUNTER:600:0:999999999 " : "");
	str += ((buf['kw_hi_ret'] !== undefined) ? "DS:kw_hi_ret:COUNTER:600:0:999999999 " : "");
	str += ((buf['kw_lo_ret'] !== undefined) ? "DS:kw_lo_ret:COUNTER:600:0:999999999 " : "");
	str += ((buf['gas_use'] !== undefined) ? "DS:gas_use:COUNTER:600:0:999999999 " : "");
	str += ((buf['kw_act_use'] !== undefined) ? "DS:kw_act_use:GAUGE:600:0:999999 " : "");
	str += ((buf['kw_act_ret'] !== undefined) ? "DS:kw_act_ret:GAUGE:600:0:999999 " : "");
	str += ((buf['kw_ph1_use'] !== undefined) ? "DS:kw_ph1_use:GAUGE:600:0:999999 " : "");
	str += ((buf['kw_ph2_use'] !== undefined) ? "DS:kw_ph2_use:GAUGE:600:0:999999 " : "");
	str += ((buf['kw_ph3_use'] !== undefined) ? "DS:kw_ph3_use:GAUGE:600:0:999999 " : "");
	
	str += "RRA:AVERAGE:0.5:1:360 ";		// Hour: every 10 secs sample, consolidate 1 -> 360 per hour
	str += "RRA:AVERAGE:0.5:30:288 ";		// Day: every 10 secs sample, consolidate 30 (5min) -> 12 per hour, 12*24= 288 a day
	str += "RRA:AVERAGE:0.5:90:672 ";		// Week: 10 sec sample, consolidate 90 (= 15 min);  4 * 24 hrs * 7 day
	str += "RRA:AVERAGE:0.5:360:744 ";		// Month: 10 sec sample consolidate 360 samples (1 hr) -> 24 pday * 31 a month
	str += "RRA:AVERAGE:0.5:216:1460 ";		// Year: 10 sec sample * 360 (=hour) * 24 = consolidate 4 per day. Do 365 days a year
	// Week low and high values (hourly sample)
	str += "RRA:MIN:0.5:90:672 ";			// MIN: 10 sec sample, consolidate 90 (= 15 min);  4 * 24 hrs * 7 day
	str += "RRA:MAX:0.5:90:672 ";			// MAX
	// str += "RRA:AVERAGE:0.5:360:720 ";		// AVG
	
	var execStr = "rrdtool create "+db+" --step 20 "+str;
	logger("createEnergyDb:: execStr: "+execStr,1);
	exec(execStr, function (error, stdout, stderr) {
		if (error === null) { 
			logger("createEnergyDb:: ok, stdout: "+ stdout + "; stderr: " + stderr , 2); 
			energyHandler(buf, socket);				// sort of callback mechanism. But only 1 time
		}
		else  { logger("createEnergyDb:: ERROR: "+ error  + "; stderr: " + stderr ); 
		}
	});		
}

function energyHandler(buf, socket) {
	var db = rrdDir + "/db/" +"e350.rrd";
	
	var str=[];
	logger("energyHandler:: action: "+ buf.action+", brand: "+buf.brand,1);

	if (!fs.existsSync(db)) {
		logger("weatherHandler:: rrdtool db "+db+" does not exist ... creating",1);
		createEnergyDb(db,buf);
	}
	//if (array_key_exists('kw_hi_use',$sensor))		$values .= ":".intval($sensor['kw_hi_use']*1000,10);
	str += ":" + Math.floor(Number(buf['kw_hi_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_lo_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_hi_ret'])*1000);
	str += ":" + Math.floor(Number(buf['kw_lo_ret'])*1000);
	str += ":" + Math.floor(Number(buf['gas_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_act_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_act_ret'])*1000);
	str += ":" + Math.floor(Number(buf['kw_ph1_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_ph2_use'])*1000);
	str += ":" + Math.floor(Number(buf['kw_ph3_use'])*1000);
		
	var execStr = "rrdtool update "+db+" N" +str;
	logger("energyHandler:: execStr: "+execStr,2)
	exec(execStr, function (error, stdout, stderr) {
		if (error === null) { 
			logger("energyHandler:: stdout: "+ stdout + "; stderr: " + stderr, 2 ); 
		}
		else  { logger("energyHandler:: ERROR: "+ error  + "; stderr: " + stderr ); 
		}
	});
}

// --------------------------------------------------------------------------------
// GUI Handler
// Same as icsHandler but then for type=='json'
// --------------------------------------------------------------------------------
function guiHandler(buf, socket) {
	logger("guiHandler:: buf: "+buf,1);
	var index = gaddrDevice(buf.gaddr, uaddr);		// which gaddr matches the received gaddr in lampi_devices array
	if (lampi_devices[index]['gaddr'] == "868" ) deviceSet(index, buf.val);	// zwave only 
	// Have to make a good data.ics value (cannot assume that a json message has a good ics)
	var ics = "!R"+lampi_devices[index]['room']+"D"+lampi_devices[index]['uaddr']+"F";
	if (buf.val == 0) ics = ics+"0";
	else ics = ics + "dP" + buf.val;
	var data = {
		tcnt: ""+tcnt++ ,
		type: "json",
		action: "gui",				// actually the class of the action
		cmd: buf.cmd,
		gaddr: ""+buf.gaddr,
		uaddr: ""+buf.uaddr,
		val: ""+buf.val,
		message: buf.ics	
	};
	logger("guiHandler:: to broadcast: "+JSON.stringify(data),2);
	var ret = broadcast(JSON.stringify(data), socket);	// XX works for websocket that is initiating the GUI request
}

// --------------------------------------------------------------------------------
// ICS Handles incoming messages on a socket, relevant data is in ICS coded string
// Could be devices and sensors LamPI gui commands
// --------------------------------------------------------------------------------
// Fields received from the LamPI GUI buf
// 'tcnt'    :	<Transaction Count>
// 'type'    : 'raw'
// 'cmd'     : 'kaku', 'livolo', 'zwave'
// 'action'  : 'gui'
// 'message' : '<ICS 1000 message format>'
function icsHandler(buf, socket) {
	logger("icsHandler:: receiving message: "+buf.message,2);
	var ics =    buf.message;
	var type =   buf.type;
	var action = buf.action;
	
	var r = /\d+/;
	///\d+\.?\d*/g
	switch (ics.substr(0,2)) {
		case '!R':	// Room commands !RxxDyyFz !RxxDyyFdPzz
			// value and val are mostly the same. Only as the JSON message does not see difference
			// between switches and dimmers (yet), we send "on" and "off" for switches in val.
			var val = "";									// The return value in Json for device
			var room = ics.match(r);
			if (ics.indexOf('Fa') != -1) {					// All Off !RxFa received
				allOff(room, socket);
				break;
			}
			var s = ics.indexOf('D');
			var uaddr = ics.substr(s+1,2).match(r);
			logger("icsHandler:: uaddr: "+uaddr,2);
			
			s = ics.indexOf('FdP');
			var value;
			if (s != -1) {									// Dimmer
				value = Number(ics.substr(s+3,2).match(r));
				val = value;
				logger("icsHandler:: Found dimmer value: "+value ,2);
			}
			else {											// This is a switch
				s = ics.indexOf('F');
				value = ics.substr(s+1,2).match(r);
				if (value == 0) val = "off";
				if (value == 1) val = "on";
				logger("icsHandler:: Found switch value: "+value ,2);
			}
			var index = findDevice(room,uaddr);	
			if ((index <0) || (index> config['devices'].length)) {
				logger("icsHandler:: ERROR for index: "+index+", #devices: "+config['devices'].length+" room: "+room+", uaddr: "+uaddr+", ics: "+ics,1);
				return;
			}
			var gaddr = config['devices'][index]['gaddr'];		// which gaddr is ok (send to correct 433 or 868 device handler)
			var brand = config['brands'][ config['devices'][index]['brand'] ]['fname'];
			if (lampi_devices[index]['gaddr'] == "868" ) deviceSet(index, value);	// zwave only 
			var data = {
				tcnt: ""+tcnt++ ,
				type: "raw",
				action: "gui",							// actually the class of the action
				cmd: brand,								// Contains the brandname for the device!!
				gaddr: ""+gaddr,
				uaddr: ""+uaddr,
				val: ""+val,
				message: ics	
			};
			config['devices'][index]['val']=value;			// Set the value in the config object
			updDevDb("devices", config['devices'][index], function(result) { 
				logger("icsHandler:: updDevDb ics "+ics+" finished OK",1); }); // only for PI-node restart	
			logger("icsHandler:: to broadcast: "+JSON.stringify(data),2);
			var ret = broadcast(JSON.stringify(data), socket);	// Send to the connected sockets (GUI's and Sensors)
		break
		case '!F': // Scene commands
			// !FcP"scene name" ; Stop a scene
			// !FqP"scene name" ; Start a scene
			queue.qinsert({ticks: getTicks(), scene: "gui", seq: "weetikveel"});
		break
		case '!T': // Timer command, deal with time, sunrise, sunset
			// Find correct syntax for Timer messages
			logger("icsHandler:: Timer command");
			queue.qinsert({ticks: getTicks(), scene: "gui", seq: "!R1D1F0"});
		break
		case '!A':
			logger("icsHandler:: Handset command",1);
			
		break
		case '!Q':
			logger("icsHandler:: All Off Q command",1);
			
		break
		default:
			logger("icsHandler:: Unknown command ics code: <"+ics+">" , 1);	
		break
	}
	// Now make a ICS command for either Z-Wave or for KlikAanKlikUit
}

// --------------------------------------------------------------------------------
// WEATHER Handlers with RRDTOOL
// --------------------------------------------------------------------------------
function createWeatherDb(db,buf,socket) {
	var str=[];
	logger("createWeatherDb:: ",1);
	str += ((buf['temperature'] !== undefined) ? "DS:temperature:GAUGE:600:-20:95 " : "");
	str += ((buf['humidity'] !== undefined) ? "DS:humidity:GAUGE:600:0:100 " : "");
	str += ((buf['airpressure'] !== undefined) ? "DS:airpressure:GAUGE:600:900:1100 " : "");
	str += ((buf['altitude'] !== undefined) ? "DS:altitude:GAUGE:600:-100:1200 " : "");
	str += ((buf['windspeed'] !== undefined) ? "DS:windspeed:GAUGE:600:0:200 " : "");
	str += ((buf['winddirection'] !== undefined) ? "DS:winddirection:GAUGE:600:0:359 " : "");
	str += ((buf['rainfall'] !== undefined) ? "DS:rainfall:GAUGE:600:0:25 " : "");
	str += "RRA:AVERAGE:0.5:1:480 ";			// Day: every 3 min sample counts, 20 per hour, 20*24=480 a day
	str += "RRA:AVERAGE:0.5:5:672 ";			// Week: 3 min sample, consolidate 5 (=15 min); thus 4 per hour * 24 hrs * 7 day
	str += "RRA:AVERAGE:0.5:20:744 ";			// Month: Every 3 minutes -> 20 samples per hour, * 24 hrs * 31 days
	str += "RRA:AVERAGE:0.5:480:365 ";			// Year: 3 min sample * 20 (=hour) * 24 = consolidate per day. Do 365 days a year
	str += "RRA:MIN:0.5:20:720 ";		
	str += "RRA:MAX:0.5:20:720 ";				
	str += "RRA:AVERAGE:0.5:20:720 ";	
	
	var execStr = "rrdtool create "+db+" --step 180 "+str;
	logger("createWeatherDb:: execStr: "+execStr,1);
	exec(execStr, function (error, stdout, stderr) {
		if (error === null) { 
			logger("createWeatherDb:: ok, stdout: "+ stdout + "; stderr: " + stderr , 2); 
			weatherHandler(buf, socket);				// sort of callback mechanism. But only 1 time
		}
		else  { logger("createWeatherDb:: ERROR: "+ error  + "; stderr: " + stderr ); 
		}
	});		
}

function weatherHandler(buf, socket) {
	var index = addrSensor(buf.address,buf.channel);
	var name = config['weather'][index]['name'];
	var db = rrdDir + "/db/"+name+".rrd";
	var str=[]; var sname;
	if ((socket !== undefined) && (socket !== null)) sname = socket.name; else sname = "datagram";
	logger("weatherHandler:: from: "+sname+", name: "+ name+", addr: "+buf.address+", chan: "+buf.channel+", temp: "+buf.temperature,1);

	if (!fs.existsSync(db)) {
		logger("weatherHandler:: rrdtool db "+db+" does not exist ... creating",1);
		createWeatherDb(db,buf, socket);
	}
	// XXX assignments below need rework. 
	// If a key does not exits, use empty value and print NO colon
	str += ((buf['temperature'] !== undefined) ? ":"+Number(buf['temperature']) : "");
	str += ((buf['humidity'] !== undefined) ? ":"+Number(buf['humidity']) : "");
	str += ((buf['airpressure'] !== undefined) ? ":"+Number(buf['airpressure']) : "");
	str += ((buf['altitude'] !== undefined) ? ":"+Number(buf['altitude']) : "");
	str += ((buf['windspeed'] !== undefined) ? ":"+Number(buf['windspeed']) : "");
	str += ((buf['winddirection'] !== undefined) ? ":"+Number(buf['winddirection']) : "");
	str += ((buf['rainfall'] !== undefined) ? ":"+Number(buf['rainfall']) : "");
	var execStr = "rrdtool update "+db+" N"+str;
	logger("weatherHandler:: execStr: "+execStr,2);
	exec(execStr, function (error, stdout, stderr) {
		if (error === null) {
			logger("weatherHandler:: stdout: "+ stdout + "; stderr: " + stderr , 2); 
		}
		else  { logger("weatherHandler:: ERROR: "+ error  + "; stderr: " + stderr ,0); 
		}
	});
}

// -------------------------------------------------------------------------------
// Handle incoming messages over the socket
// 	This is a generic fuction to read messages from socket. The separate gui/weather specific
//	functions are found above.
// The data variable is a json string.
// -------------------------------------------------------------------------------

function socketHandler(data,socket) {
	var str = data+"";						// String termination is required for search() and probably JSON too
	//console.log("dat: "+str);
	var s = str.search(/\}{/);				// With raw sockets 2 concatenated messages may arrive
	if (s != -1) 
	{										// Split data and call recursively
		var str1 = str.substr(0,s+1);
		var str2 = str.substr(s+1);
		logger("socketHandler:: string 1: "+str1,2);
		logger("socketHandler:: string 2: "+str2,2);
		socketHandler(str1,socket);
		socketHandler(str2,socket);			// Should there be another combined message this will handle it.
		return;
	};
	logger("socketHandler:: Starting with data: "+data,2);
	
	try {
		var buf = JSON.parse(str);
	} catch(e){
		logger("socketHandler:: JSON parse error: "+e,1);
		return;
	}
	if (socket == undefined) {				// UDP message most likely
		logger("socketHandler socket undefined. action: "+buf.action,2);
		if (debug >= 2) console.log("data: ",str);
		socket = null;
	}
	logger("Handler:: Action: "+buf.action,2);
	
	switch (buf.action) {
		case 'alarm':
			logger("socketHandler:: alarm received",1);
			// Do something :-)
		break;
		case 'console':		// request can be: "logs", "zlogs", "sunrisesunset", "clients", "rebootdaemon"
			consoleHandler(buf.request, socket);
		break;
		case 'dbase':						// cmd can be: delete_scene, 
			dbaseHandler(buf.cmd, buf.message, socket);
		break;
		case 'energy':						// cmd can be: energy
			energyHandler(buf, socket);			// Do something: such as store in RRD etc
			broadcast(str ,socket);				// Just forward to clients
		break;
		case 'gui':			//
			if (buf.type == "raw")  icsHandler(buf, socket);
			if (buf.type == "json") guiHandler(buf, socket);		
		break;
		case 'load_database':		// Re-Read the database (NOT init the database), response contains result
			logger("socketHandler:: load_database received",1);
			var response = {
				tcnt: tcnt++ ,
				type: "raw",
				action: "load_database",		// actually the class of the action
				cmd: "",	
				response: config				// Message to popup in 
			};
			//if (socket.type == "ws") { 	
				var ret = socket.send(JSON.stringify(response),function (error){
					if (error !== undefined) { 
						logger("socketHandler:: ERROR returning load database "+error,1);
						logger("socketHandler:: Socket: "+socket.name+", type: "+socket.type,1);
					}
				});	
			//}	
			//else logger("Not a Websocket");
		break;
		case 'ping':							// Respond to ping with ack to requestor only => healthcount++
		case 'PING':
			// Send back to sender
			logger("socketHandler:: ping received",2);
			var response = {
				tcnt: tcnt++,
				action: "ack",
				type: "raw",
				message: "OK"
			};
			if (socket.type == "ws") { var ret = socket.send(JSON.stringify(response)); }
		break;
		case 'scene':
			logger("socketHandler:: scene received",2);
			
		break;
		case 'weather':
			// XXX tbd Handle incoming weather messages for RRDtool
			weatherHandler(buf, socket);
			broadcast(str, socket);
		break;
		default:
			logger("SocketHandler:: action not recognized: "+buf.action,1);
		break;
	}
}

// --------------------------------------------------------------------------------
// QUEUE Object definitions (singleton stye as a function)
// The queue contains a list of actions that are outstanding
// --------------------------------------------------------------------------------
//
var queue = new function() {
	this.qlist= [];
	// Need to use the splice function here
	this.qpush= function (sc) {
		var item = {
			ticks: getTicks(),
			name: sc.name,
			seq: sc.seq
		}
		this.qlist.push(item)
	};
	this.qinsert= function(item) {
		var i;
		for (i=0; i< this.qlist.length; i++) {
			if (this.qlist[i].ticks > item.ticks) break;
		}
		this.qlist.splice(i,0,item);
	}
	this.qpop= function () {
		var i;
		var tim = getTicks();
		for (i=0; i< this.qlist.length; i++) {
			if (this.qlist[i].ticks > tim) break;
		}
		return(this.qlist.splice(0,i) );
	};
	this.qprint= function () {
		var ticks = getTicks();
		var tim = queue.qtim();
		if (tim == null) return;				// No itms
		logger("print queue for ticks: "+ticks+", next runnable: "+tim+" secs",1);
		for (var i=0; i<this.qlist.length; i++) {
			console.log("\t\t",this.qlist[i]);
		}
	};
	this.qtim= function() {
		if (this.qlist.length == 0) return (null);
		var tim = getTicks();
		return (this.qlist[0].ticks - tim);
	}
}

queue.qinsert({ticks: getTicks()+ 30, name: "gui", seq: "!R1D1FdP10"});
queue.qinsert({ticks: getTicks()+ 45, name: "gui", seq: "!R1D1F0"});


// --------------------------------------------------------------------------------
// QUEUE Loop with interval
//
// As from that moment on the lampi_devices will be in memory and always available
// XXX At the moment, for gui only ICS raw coded commands are stored in Queue
// XXX Todo: We can put whatever task we want in the queue, including thermostat, emails etc etc.

function queueHandler() {
	var task = queue.qpop();
	while ((task != null) && (task.length > 0)) {				// Might be more than one task runnable
		if (debug>=2) console.log("queueHandler:: pop task: ",task);
		for (var i=0; i< task.length; i++) {					// For every scene runnable after pop(), could be 0
			var cmds;
			if (debug>=1) console.log("\t\tqueueHandler:: processing task: ",task[i]);
			if (task[i].name != "gui") {						// The scene name is a real scene 
				// Lookup scene or task and Send to connected sockets
				var index = findScene(task[i].name);
				cmds = config['scenes'][index].seq.split(",") ;
			}
			else {												// Gui ALL OFF command
				cmds = task[i].seq.split(",");					// Get all ICS commands in the scene
			}
			// For each cmd in the seq separately call the handler
			for (var j = 0; j<cmds.length; j++) {
				var data = {
					tcnt: ""+tcnt++ ,
					type: "raw",
					action: "gui",								// actually the class of the action
					cmd:   "",									// Optional for ics messages, otherwise kaku, zwave, livolo etc.
					gaddr: "",									// Optional
					uaddr: "",									// Optional
					val:   "",									// Optional
					message: cmds[j]
				};
				icsHandler(data);								// Fills out missing JSON fields. We do not specify socket as 2nd arguments
			}	// XXX Should be socketHandler to be more generic!
		}
		task = queue.qpop();									// Next pop
	}
	if (debug>=2) queue.qprint();
}


// ================================================================================
//
//                                MAIN part
//
// ================================================================================
logger("MAIN part started");

// INIT Put all functions for init here, after that, main() is started.
async.series([
	function (callback) {
		connectDbase(callback);
	},
	// Load the database to get the LamPI data
	function(callback) {
		loadDbase(callback);
	},
	// Do the CURL request to Z-Wave to load the devices data
	function(callback) {
		zwave_init(function(err,result) { callback(null,result); } );
	}
], function(err,results)  {
	main(err,results); 
})

function main(err,results) {
	loops = [];
	// Callback function after done all relevant init functions
	logger("All Init functions done",1); 
	if (debug>= 1) console.log("Return values: \n",results);
	alarm_loop();						// Every 2 seconds handle alarms
	timer_loop();						// Every 60 seconds timer queue and logging
	poll_loop();						// Every 6 seconds test changed values from Z-Wave
	log_loop();
	
	logger("Starting Static Webserver");
	// NOTE: All pathnames are relative to the Node Installation directory
	app.use(serveStatic(__dirname + '/www')); app.listen(webPort);

}

// --------------------------------------------------------------------------------
// TIMER LOOP
// Logging loop with interval of around 30-60 seconds.
// Prequisites:: The lampi_devices array must be present
// 1. Re-init the Z-Wave data structure
// 2. The Timer Array of LamPI will be read every xx seconds and when necessary timers
// that are ready will be put on the run Queue.
function timer_loop() {
  var i = 0;
  logger("Starting timer_loop",1);
  var id = setInterval ( function() {
	var now = new Date();						  
	var ticks = Math.floor(now.getTime()/1000);
	logger('Loop '+i+", ticks: "+ticks+", devices: "+Object.keys(devices).length,2); 

	logger("----------- TIMER EXPIRED? ------------",1);
	// Refresh timers AND scenes from database from database
	queryDbase('SELECT * from timers',function (err, timers) { 
	  config['timers']=timers; 
	  logger("timer_loop:: #timers: "+timers.length,2); 
	  queryDbase('SELECT * from scenes',function (err, scenes) {
		config['scenes']=scenes;
		logger("timer_loop:: now   date: "+now,1);
		var scalc = SunCalc.getTimes(now, 52.13, 5.58);				// This is for Apeldoorn
		for (var i=0; i<timers.length; i++) {
			var st = timers[i].tstart.split(":"), start_hour = st[0], start_minute = st[1];
			var st = timers[i].startd.split("\/");
			var start_day = st[0], start_month = st[1], start_year = Number(st[2])+2000;
			st = timers[i].endd.split("\/");
			var end_day = st[0], end_month = st[1], end_year = Number(st[2])+2000;

			var hour, minute, day, month, year, corr;
			day = now.getDate();			// Day of month 1 to 31
			month = now.getMonth();			// From 0 to 11
			year = now.getFullYear();		// 4 digits
			switch (start_hour) {			// Correct hours and minutes when sundawn or dusk is specified for timer
				case '96':
					corr = -Number(start_minute)*30*60;	// Correction
					hour = scalc.sunrise.getHours();
					minute = scalc.sunrise.getMinutes() ;
				break
				case '97':
					corr = Number(start_minute)*30*60;
					hour = scalc.sunrise.getHours();
					minute = scalc.sunrise.getMinutes();
				break
				case '98':
					corr = -Number(start_minute)*30*60;
					hour = scalc.sunset.getHours() ;
					minute = scalc.sunset.getMinutes();
				break
				case '99':
					corr = Number(start_minute)*30*60;
					hour = scalc.sunset.getHours();
					minute = scalc.sunset.getMinutes();
				break
				default:
					corr = 0;
					hour = start_hour;
					minute = start_minute;
				break
			}
			
			var td = Math.floor(new Date(year, month, day, hour, minute, 0, 0).getTime()/1000) + corr;
			logger("Timer correction is: "+corr,2);
			logger("timer_loop:: run   date: "+td,2);
			logger("timer_loop:: now   date: "+ticks,2);
			if ((td-ticks) > 0) logger("timer_loop:: name: "+timers[i]['name']+", runnable in: "+(td-ticks)+" secs",1);
			if (ticks < td) {logger("Timer not yet started ",2) ; continue; };
			
			var ed = Math.floor( new Date(end_year, end_month-1, end_day, 0, 0, 0, 0).getTime()/1000); 
			logger("timer_loop:: end date:   "+ed,2);
			if (ticks > ed) {logger("Timer enddate reached: "+ed,1) ; continue; };
			
			var sd = Math.floor( new Date(start_year, start_month-1, start_day, start_hour, start_minute, 0, 0).getTime()/1000);
			logger("timer_loop:: start date: "+sd,2);
			if (ticks < sd) {logger("Timer before start date",1) ; continue; };
			
			if ((ticks - td) > (timer_interval/500 + 1 )) { logger("Timer already started some time ago",2); continue; };
			if ((ticks - td) > (timer_interval/1000 )) { logger("Timer already started",2); continue; };
			
			// Look whether day off week or month is a blackout
			if (timers[i]['months'][Number(now.getMonth())-1] == 'x') { logger("Timer, this is a blackout month",1); continue; }
			if (timers[i]['days'][Number(now.getDay())-1] == 'x') { logger("Timer, this is a blackout day",1); continue; }

			// If we are here, at least we knowthat we can start this timer. 
			logger("timer_loop:: Starting timer name: "+timers[i]['name'],1);

			// Now for every command in the scene make sure that it is put on the queue
			// This means that ics strings have a time component in the scene array. Make sure
			// every timer is copied on the queue as well	
			var j; var splits;
			for (j=0; j<scenes.length; j++) {
				if ( scenes[j]['name'] == timers[i]['scene'] ) {
					splits = scenes[j]['seq'].split(",");
					for (var k=0; k< splits.length; k+=2) {
						logger("scene item: "+(k/2)+", val: "+splits[k]+", time: "+splits[k+1],1);
						var effe = splits[k+1].split(":");
						var sticks = +(effe[0]*3600)+(effe[1]*60)+effe[2];
						logger("qinsert:: ticks: "+sticks+", name: "+scenes[j]['name']+", seq: "+splits[k],1);
						// Use gui as name as we have a gui ICS seq here. 
						// The queue can handle scene names as well but then leave the seq field empty
						queue.qinsert({ ticks: Number(sticks) + getTicks(), name: "gui", seq: splits[k] });
					}//for k
				}//if
			}//for j
		}//for i
	  });//scenes
	});//timers
  }, timer_interval );
  loops.push(id);
}

// --------------------------------------------------------------------------------
// LOGGING LOOP
//
// 1. Display log value of Z-Wave devices based on complete init
// 2. We update values in the Z-Wav and LamPI environment and update database
// 3. We broadcast values of sensors to connected gui clients
//
function log_loop() {
  logger("Starting log_loop");
  var i=0;
  var id = setInterval ( function() {
								  
	// Display Active clients
	if (debug >= 2) {
		logger("----------- ACTIVE CLIENTS ------------",1);
		logger("Active socket Clients:: ",1);
		clients.forEach(function (client) {
			console.log(client.type+" Client: "+client.name);
		});
	}
	
	logger("----------- ACTIVE ZWAVE DEVICES ------------",1);
	// Do a complete init of the datasctructure every 60 seconds just to be sure we didnt miss updates
	zwave_init(function(err,result) {logger("log_loop:: zwave_init: "+result,1); } ); 
	var ticks = Math.floor(Date.now()/1000);
	logger('Loop '+i+", ticks: "+ticks+", devices: "+Object.keys(devices).length,2);

	// Logging of all Z-Wave devices in the zroot data structure
	Object.keys(devices).forEach(function(key) {
		if (key > 1) {												// Skip over controller id=1
			logger("key: " + key,1);
			var classes = devices[key].instances[0].commandClasses;
			if (debug>2) console.log(classes);
			Object.keys(classes).forEach(function(cl) {	
				switch(cl) {

					case '37':									// SWITCH
					// If not a Battery get the value of the device
						var val        = classes[cl].data.level.value + 0;
						var lupdate    = classes[cl].data.level.updateTime;
						var invalidate = classes[cl].data.level.invalidateTime;
						logger("\tCl: "+cl+" Switch           , val "+val+", upd: "+printTime(lupdate*1000)+", inval: "+printTime(invalidate*1000),1);
					break;
					case '38':									// DIMMER
						var val = classes[cl].data.level.value + 0;
						var lupdate = classes[cl].data.level.updateTime;
						var invalidate = classes[cl].data.level.invalidateTime;
						logger("\tCl: "+cl+" Dimmer           , val "+val+", upd: "+printTime(lupdate*1000)+", inval: "+printTime(invalidate*1000),1);
					break;
					case '39':
						//var val = classes[cl].data.level.value + 0;
						logger("\tCl: "+cl+" Dimmer?          , val "+val,2);
					break;
					case '48':									// Sensor Binary -> PIR alarm
						if (classes[cl].data.interviewDone.value == false) {
							logger("WARNING:: Device "+cl+" Dead",1);
							break;
						}
						var val = classes[cl].data[1].level.value + 0;
						var lupdate = classes[cl].data[1].level.updateTime;
						logger("\tCl: "+cl+" PIR              , val "+val+", upd: "+printTime(lupdate*1000),1);
					break;
					case '49':									// Sensor Multilevel -> Luminescense
						if (classes[cl].data.interviewDone.value == false) {
							logger("WARNING:: Device "+cl+" Dead",0);
							break;
						}
						if( 1 in classes[cl].data) {			// Temperature
							var val = classes[cl].data[1].val.value + 0;
							logger("\tCl: "+cl+" Temp             , val "+val,1);
							var index = addrSensor(key,0);
							config['weather'][index]['temperature'] = val;
							//break;
						}
						if( 3 in classes[cl].data) {			// Luminescense
							var val = classes[cl].data[3].val.value + 0;
							logger("\tCl: "+cl+" Lumi             , val "+val,1);
						}
						if( 5 in classes[cl].data) {			// Humidity
							val = classes[cl].data[5].val.value + 0;
							logger("\tCl: "+cl+" Humi             , val "+val,1);
							// Send to broadcast!
							// index in devices is 'key' which is channel in weather array.
							var index = addrSensor(key,0);
							config['weather'][index]['humidity'] = val;
						}
						var buf = {
							tcnt: ""+tcnt++,
							action: "weather",
							type: "json",
							address: key+"",
							channel: "0",
							temperature: config['weather'][index]['temperature'],
							humidity : config['weather'][index]['humidity'],
							airpressure: "",
							windspeed: "", 
							winddirection: "",
							rainfall: ""
						}
						logger("log_loop:: starting weather handler for device: "+key,2);
						weatherHandler( buf )
						broadcast(JSON.stringify(buf) ,null);
					break;
					case '67':									// Thermostat
						if (classes[cl].data.interviewDone.value == false) {
							logger("WARNING: Thermostat device "+key+" Dead",0);
							break;
						}
						var val = classes[cl].data[1].val.value + 0;
						logger("\tCl: "+cl+" Thermostat       , val "+val,1);
					break;
					case '112':
						logger("\tCl: "+cl+" Configuration",2);
					break;
					case '128':
						var val = classes[cl].data.last.value;
						var lupdate = classes[cl].data.last.updateTime;
						logger("\tCl: "+cl+" Battery         , "+val+"%, upd: "+printTime(lupdate*1000),1);
					break;
					case '132':
						logger("\tCl: "+cl+" Wakeup",2);
					break;
					case '133':
						logger("\tCl: "+cl+" Association",2);
					break;
					case '142':
						logger("\tCl: "+cl+" MultiCh Assoc",2);
					break;
					case '143':
						logger("\tCl: "+cl+" MultiCh Assoc",2);
					break;
					case '156':
						logger("\tCl: "+cl+" Alarm Sensor",1);
					break;
					default:
						logger("\tCl: "+cl+" Device not yet handled",2);
					break;
				}
			});
		}
	});
	i++;
  }, log_interval );
  loops.push(id);
}

// --------------------------------------------------------------------------------
// POLL Loop with interval
//
// Ths may not be necessary once we take over the daemon function as well
// As from that moment on the lampi_devices will be in memory and always available
//
function poll_loop() {
  logger("Starting poll_loop");
  var id = setInterval ( function() {
	logger("-----------       POLL      ------------",1);
	connection.query('SELECT * from devices', function(err, rows, fields) {
		if (err) throw err;
		config['devices'] = rows;
		lampi_devices = config['devices'];			// This is a shortcut to the main config structure
  		if (debug >= 3) console.log('query devices:: is: \n', rows);
		// Loop in our list of devices (not sensors) and make sure that for every one we take action
		for (var i=0; i< lampi_devices.length; i++) {
			if (lampi_devices[i]['gaddr'] == "868") {				// Is this a Z-Wave device
				// Remember this IS async so do not assume below we have a changed value
				deviceGet(i,lampi_devices[i]['type']);				// Update the Z-Wave device tree asynchronous
			}//if 868
		}//for
	});
  }, poll_interval );
  loops.push(id);
}


// --------------------------------------------------------------------------------
// ALARM loop with interval
// 
// As alarms do not need a polling of the data (the value gets pushed to the Z-Wave controller)
// we need to make SURE that all data has been read or the function might fail.
//
// Also, as the alarm loop has finest timing granularity, we read the ready queue for runnable commands!
//
// ??? Maybe start with binding functions to changed values
//
function alarm_loop()
{
  logger("Starting alarm_loop");
  
  var id = setInterval ( function() {
	var	zTime = Math.floor(Date.now()/1000);					// 
	zwave_upd_options.path = '/ZWaveAPI/Data/'+(zTime - alarm_interval);
	logger("alarm_loop:: zTime: "+(zTime-alarm_interval),2);
	
	// As alarm polling gtakes place most often, the main poll look is in this function too
	
	// XXX 			This update data function does not yet work reliable in 2.0.1.rc27!
	http.request(zwave_upd_options, zwave_upd_cb).end();
		
	var alarm1 = devices[9].instances[0].commandClasses[48].data[1].level.value;
	if (alarm1 === true) {
		console.log("Fibaro ALARM");
		var data = {
			tcnt: 868,
			type: "json",
			action: "alarm",									// actually the class of the action
			scene: "Living on",									// Scene name to be executed
			message: "Fibaro ALARM"								// Message to popup in the GUI
		};
		var ret = broadcast(JSON.stringify(data), null);
		//var ret = client.write(JSON.stringify(data));
		//devices[9].instances[0].commandClasses[48].data[1].level.value = false;
	}
	var alarm2 = devices[11].instances[0].commandClasses[48].data[1].level.value;
	if (alarm2 === true) {
		console.log("Aeon ALARM");
		var data = {
			tcnt: 868,
			type: "json",
			action: "alarm",									// actually the class of the action
			scene: "",											// Scene name to be executed
			message: "AEON ALARM"								// Message to popup in the GUI
		};
		var ret = broadcast(JSON.stringify(data), null);
		// This will be overwritten when new data arrives
		devices[11].instances[0].commandClasses[48].data[1].level.value = false;
		// Switch off the alarm XXX not elegant. Should tell the device to be silent 30 secs after first alarm
	}
	
	logger("----------- QUEUE HANDLER -------------",2);
	queueHandler();													// Handle the run queue of LamPI commands
	
  }, alarm_interval );
  loops.push(id);
}

// --------------------------------------------------------------------------------
//
// CLOSING part
//
logger("LamPI-node.js completely parsed");
//connection.end();