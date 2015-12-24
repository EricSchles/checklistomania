var express = require('express');
var MongoClient = require('mongodb').MongoClient;
var mkdirp = require('mkdirp');
var fs = require('fs');

var url;
if(process.env.VCAP_SERVICES) {
	vcapServices = JSON.parse(process.env.VCAP_SERVICES);
	url = vcapServices["mongodb26-swarm"][0].credentials.uri	
} else {
	url = 'mongodb://localhost:27017/checklistomania';
}

MongoClient.connect(url, function(err, db) {
	items = db.collection("items");
	checklists = db.collection("checklists");
	fs.readdir('./checklists', function(err, files) {
		files.forEach(function(fileName) {
	  var filePath = 'checklists/' + fileName;
	  fs.readFile(filePath, 'utf8',
	  	function(err, data) {
	  		checklist = JSON.parse(data);
	  		checklists.update({"checklistName": checklist.checklistName}, checklist, {"upsert": true});
	  	})		
		});
	});
});

var router = express.Router();

router.get('/', function(req, res) {
    res.json({ message: 'hooray! welcome to the api!' });
});

router.get('/isalive', function (req, res) {
  res.send('OK');
});

router.get('/assign-checklist', function (req, res) {
	var dayZeroDate = new Date(parseInt(req.query.dayZeroDate));
	checklists.findOne({checklistName: req.query.checklistName}, function(err, checklist) {
		checklist.items.dayZero["completedDate"] = dayZeroDate;
		timestamp = new Date().getTime();
		for(var itemId in checklist.items){
			var item = checklist.items[itemId];

			item["itemId"] = itemId;
			item["owner"] = req.user.username;
			item["ownerName"] = req.user._json.name;
			item["ownerImgUrl"] = req.user._json.avatar_url;
			item["checklistName"] = req.query.checklistName;
			item["notes"] = req.query.notes;
			item["timestamp"] = timestamp;

			if(item.dependsOn.indexOf("dayZero") >= 0) {
				var dueDate = new Date();
				dueDate.setTime(dayZeroDate.getTime() + item.daysToComplete*24*60*60*1000 + 1);
				item["dueDate"] = dueDate;
			};

			items.insert(item);
		}
		res.json({"checklistName": req.query.checklistName, "dayZero": dayZeroDate.toISOString()});
	});
});

router.get('/get-items', function(req, res) {
	var username = req.query.username || req.user.username;
	items.find({owner: username, dueDate: {$exists: true}, completedDate: {$exists: false}}, {sort: [["dueDate", 1]]})
		.toArray(function(err, userItems) {
			res.json({items: userItems});		
		});
});

router.get('/get-checklists', function(req, res) {
	checklists.find({}, {sort: [["checklistName", 1]]})
		.toArray(function(err, checklists) {
			res.json({checklists: checklists});		
		});
});

router.get('/get-users', function(req, res) {
	items.find({}).toArray(function(err, allItems) {
		users = {};
		allItems.forEach(function(item) {
			if(!(item.owner in users)) {
				users[item.owner] = {earliestDueDate: new Date().setYear(3000), fullName: item.ownerName, 
					imgUrl: item.ownerImgUrl};
			}

			if(!item.completedDate && item.dueDate < users[item.owner].earliestDueDate) {
				users[item.owner].earliestDueDate = item.dueDate;
			}
		})
		res.json({users: users});
	})
})

router.get('/complete-item', function(req, res) {
	var query = {owner: req.user.username, checklistName: req.query.checklistName, 
		timestamp: parseInt(req.query.timestamp)};
	
	items.find(query)
		.toArray(function(err, userItems) {
			userItems.forEach(function(item) {
				if(item._id == req.query.id) {
					item["completedDate"] = new Date();
					items.update({_id: item._id}, item)
				};

				dependentIndex = item.dependsOn.indexOf(req.query.itemId);
				if(dependentIndex >= 0) {
					item.dependsOn.splice(dependentIndex, 1);

					if(item.dependsOn.length === 0) {
						var dueDate = new Date();
						dueDate.setDate(new Date().getDate() + item.daysToComplete);
						item["dueDate"] = dueDate;						
					}
					
					items.update({_id: item._id}, item)
				}	
			});
			res.json({success: true});
	});
		
});

module.exports = {router: router};