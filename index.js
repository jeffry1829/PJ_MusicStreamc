var config = require('./lib/config.js');
var express = require('express');
var app = express();
var jsmediatags = require('jsmediatags');
var recursive = require('recursive-readdir');
var mp3duration = require('mp3-duration');
var path = require('path');
var fs = require('fs');
var fq = require('filequeue');
var bodyParser = require('body-parser');
var jsonfile = require('jsonfile');
var queryString = require('query-string');
var getYouTubeID = require('get-youtube-id');
var youtubeInfo = require('youtube-info');
var createIfNotExist = require("create-if-not-exist");
var escape = require('escape-html');
var http = require('http');
var q = require('queue')({
	concurrency: 30 // maximum async work at a time
});

var io = require('socket.io')(app.listen(3000)); // I really don't know why it works

var y_config = './y_config.json';
createIfNotExist(y_config, '[]')
var y_Ss = jsonfile.readFileSync(y_config) ? jsonfile.readFileSync(y_config) : []; // init stat

var songpath=config['songpath'];
songpath=path.resolve(songpath);
var CurrentSong={};
var SongList={};
var QueueList=[];
var tmp_s_no=0;
var default_start_time = -3;
var is_pause = false;
var online_count = 0;
START();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(express.static(__dirname+'/web'));
app.use('/songs',express.static(songpath));
app.get('/', function(req, res){
	res.sendFile(__dirname+'/web/index.html');
})
app.post('/getCurrent',function(req, res){
	res.json(CurrentSong);
});
app.post('/setCurrent',function(req, res){ // Won't be used now
	console.log('Router /setCurrent => req.body');
	console.dir(req.body);
	
	var s_id = req.body.s_id;
	var start_time = req.body.start_time;
	
	setCurrent(s_id,start_time);
	res.end();
});
app.post('/getQueue', function(req, res){
	res.json(QueueList);
});
/*
app.post('/addQueue', function(req, res){
	addQueue(req.body.s_id, req.body.start_time);
	res.end();
});
*/
app.post('/forcePlay', function(req, res){
	forcePlay(req.body.queue_index);
	io.emit('QueueBeenSet', QueueList);
	res.end();
});
app.post('/removeQueue', function(req, res){
	removeQueue(req.body.queue_index);
	io.emit('QueueBeenSet', QueueList);
	res.end();
});
app.post('/removeYoutube', function(req, res){
	removeYoutube(req.body.youtube_s_id);
	res.json({message: 'i really dont know why i should add a json here'});
});
app.post('/getList',function(req, res){
	res.json(SongList);
});
app.post('/GlobalPause', function(req, res){
	is_pause = true;
	res.end();
});
app.post('/GlobalPlay', function(req, res){
	is_pause = false;
	res.end(); 
});
app.post('/addYoutube', function(req, res){
	var y_url = req.body.url;
	if(y_Ss.indexOf(y_url) === -1){
		y_Ss.push(y_url);
		jsonfile.writeFileSync(y_config, y_Ss);
		youtubeInfo(getYouTubeID(y_url, {fuzzy: false}), function(err, info){
			if(err){
				console.log(err);
				res.end();
				return;
			}
			SongList[tmp_s_no] = {
					s_path: false,
					s_name: info.title,
					s_id: tmp_s_no++,
					y_url: info.url, // changed to y_url
					y_id: getYouTubeID(y_url, {fuzzy: false}), // shortcut
					s_t: info.duration,
					s_type: 'Youtube',
					s_description: {
						owner: info.owner // !!! owner !!!
					}
			};
			res.json({message: 'why should i add json here'});
		});
	}
});

io.on('connection', function(socket){
	online_count++;
	io.emit('online_count', {online_count: online_count});
	
	socket.on('addQueue', function(s_id, start_time){
		addQueue(s_id, start_time);
		io.emit('QueueBeenSet', QueueList);
	})
	
	socket.on('disconnect', function(){
		online_count--;
		io.emit('online_count', {online_count: online_count});
	})
	
});

function removeYoutube(youtube_s_id){
	y_Ss.splice(y_Ss.indexOf(SongList[youtube_s_id]['y_url']), 1);
	SongList[youtube_s_id]['removed'] = true // delete this s_id !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	jsonfile.writeFileSync(y_config, y_Ss);
}
function forcePlay(queue_index){
	setCurrent(QueueList[queue_index].s_id, QueueList[queue_index].start_time);
	removeQueue(queue_index);
}
function removeQueue(queue_index){
	QueueList.splice(queue_index, 1);
	io.emit('QueueBeenSet', QueueList);
}
function setCurrent(s_id, start_time){
	console.log('setCurrent => SongList');
	console.dir(SongList);
	console.log('setCurrent => s_id');
	console.log(s_id);
	
	if(!s_id && s_id !== 0){
		s_id=0;
	}
	if(SongList[s_id]['removed']){
		CurrentSong.s_id++; // id++
		CurrentSong.s_t = CurrentSong.now_Len+1;
		interval_checking();
		return;
	}
	
	CurrentSong = {};
	CurrentSong = Object.assign(CurrentSong, SongList[s_id]);
	CurrentSong.now_Len = start_time;
	delete CurrentSong['s_path'];
	
	console.log('setCurrent => CurrentSong');
	console.dir(CurrentSong);
}
function addQueue(s_id, start_time){
	if(!CurrentSong.s_id && CurrentSong.s_id !== 0){
		setCurrent(s_id, start_time);
		return;
	}
	
	var queueItem = {};
	Object.assign(queueItem, SongList[s_id]);
	delete queueItem['s_path'];
	queueItem.s_id = s_id;
	queueItem.start_time = start_time;
	QueueList.push(queueItem);
	io.emit('QueueBeenSet', QueueList);
}
function load_one_youtube(y_Ss, index, this_f_path){
	youtubeInfo(getYouTubeID(y_Ss[index], {fuzzy: false}) ? getYouTubeID(y_Ss[index], {fuzzy: false}) : 'NO ID', function(err, info){
		if(err){
			console.log(err);
			if(y_Ss.length-1 >= index+1){
				console.log('load_one_youtube => err => y_Ss.length, index');
				console.log(y_Ss.length+', '+index);
				console.log('load_one_youtube => err => y_Ss[index]');
				console.log(y_Ss[index]);
				load_one_youtube(y_Ss, index+1, this_f_path)
			}else{
				hardsong_load(this_f_path)
			}
			return;
		}
		
		console.log('load_one_youtube => success!');
		SongList[tmp_s_no] = {
				s_path: false,
				s_name: escape(info.title),
				s_id: tmp_s_no++,
				y_url: y_Ss[index], // changed to y_url
				y_id: getYouTubeID(y_Ss[index], {fuzzy: false}), // shortcut
				s_t: info.duration,
				s_type: 'Youtube',
				s_description: {
					owner: escape(info.owner) // !!! owner !!!
				}
		};
		
		//i'm trying to make it sync
		if(y_Ss.length-1 >= index+1){
			console.log('load_one_youtube => recall!');
			load_one_youtube(y_Ss, index+1, this_f_path)
		}else{
			hardsong_load(this_f_path)
		}
	});
}
function s_reload(this_f_path){
	y_Ss = jsonfile.readFileSync(y_config) ? jsonfile.readFileSync(y_config) : [];
	if(y_Ss.length>=1){
		load_one_youtube(y_Ss, 0, this_f_path);
	}else{
		hardsong_load(this_f_path);
	}
}
function hardsong_load(this_f_path){
	recursive(this_f_path, function(err, files){
		// file order is not garenteed
		files.forEach(function(file){
			file = path.resolve(file);
			q.push(function(ok){
				jsmediatags.read(file, {
					onSuccess: function(result){
						var tags = result.tags;
							mp3duration(file, function(err, duration){
								if(err){
									console.log(err);
									ok();
									return;
								}
								SongList[tmp_s_no] = {
										s_path: file,
										s_name: escape(tags.title), // why is there a "title" tag?!, it's not mentioned in the document!
										s_id: tmp_s_no++,
										s_url: '/songs/'+path.relative(songpath,file),
										s_t: duration,
										s_type: escape(path.dirname(path.relative(songpath,file)) === '.' ? 'ROOT' : path.dirname(path.relative(songpath,file))), // new added property!
										s_description: {
											artist: escape(tags.artist),
											album: escape(tags.album)
										}
								};
								ok();
							});
				  },
				  onError: function(error){
				    console.log(':(', error.type, error.info);
				  }
				});
			})
			q.start(function(){
				console.log('q.start cb occured');
			})
		})
	})
}
function START(){
	s_reload(songpath);
}
function interval_checking(){
	if(!is_pause){
		if(CurrentSong.s_id || CurrentSong.s_id === 0){
			if(!CurrentSong.now_Len && CurrentSong.now_Len !== 0){
				CurrentSong.now_Len = default_start_time;
			}else{
				if(CurrentSong.s_t - CurrentSong.now_Len > 0){
					CurrentSong.now_Len++;
				}else{//start [When the song is over]
					if(QueueList[0]){
						setCurrent(QueueList.shift().s_id, default_start_time);
						io.emit('QueueBeenSet', QueueList);
					}else if(SongList[CurrentSong.s_id+1]){
						if(!SongList[CurrentSong.s_id+1]['removed']){ // and not removed
							setCurrent(Math.floor(Math.random()*Object.keys(CurrentSong).length), default_start_time);
						}else{ // if is removed
							CurrentSong.s_id++; // id++
							CurrentSong.s_t = CurrentSong.now_Len+1;
							interval_checking();
						}
					}else{
						setCurrent(0, default_start_time);
					}
				}//end
			}
		}
	}
}
setInterval(interval_checking,1000);



































