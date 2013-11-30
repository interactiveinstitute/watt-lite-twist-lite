'use strict';

var sum = function(a, b) { return a + b; };

var map = function(fn, t, imin, ival, omin, omax) {
  return omin + (omax - omin) * fn((t - imin) / (ival - (imin % ival)) % 1);
};

var easeInOutCubic = function(t) {
  // Based on https://gist.github.com/gre/1650294
  return t < .5 ? 4*t*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1;
};

var easeOutQuart = function(t) {
  // Based on https://gist.github.com/gre/1650294
  return 1-(--t)*t*t*t;
};

var easeInOutCirc = function(t) {
  // Based on http://www.gizma.com/easing/
  return t < .5 ? -.5 * (Math.sqrt(1 - 4 * t*t) - 1) : .5 * (Math.sqrt(1 - (t*2-2)*(t*2-2)) + 1);
};

var linear = function(t) { return t; };

var App = function() {
  this.construct.apply(this, arguments);
};

App.KEY = {
  DOWN: 40,
  UP: 38,
  SPACE: 32
};

App.STATE = {
  IDLE: 0,
  INITIALIZING: 1,
  INTRO: 2,
  WINDING: 3,
  PROGRESS: 4,
  FINISHED: 5,
  RESETTING: 6
};

App.DIRECTION = {
  INCREASE: 0,
  DECREASE: 1
};

App.prototype.construct = function(config, canvas, source) {
  this.config = config;
  this.canvas = canvas;
  
  this.drawUtil = {
    width: this.canvas.width,
    height: this.canvas.height,
    cx: this.canvas.width / 2,
    cy: this.canvas.height / 2,
    colors: []
  };
  this.config.colors.forEach(function(values, i) {
    this.drawUtil.colors[i] = values[1];
  }, this);
  
  this.measure = this.config.watthour.start;

  this.watts = [];
  this.used = [];
  this.lastUsedUpdate = 0;
  
  source.addEventListener('init', function(event) {
    this.setState(App.STATE.INTRO);
  }.bind(this));
  source.addEventListener('powerdata', function(event) {
    var data = JSON.parse(event.data).map(parseFloat);
    this.watts = data;

    if (this.state == App.STATE.INITIALIZING) this.setState(App.STATE.INTRO);
    if (this.state == App.STATE.PROGRESS ||
        (this.state == App.STATE.RESETTING &&
         this.preResetState == App.STATE.PROGRESS)) this.updateUsed();
  }.bind(this));
  source.addEventListener('increase', function(event) {
    this.twist(App.DIRECTION.INCREASE);
  }.bind(this));
  source.addEventListener('decrease', function(event) {
    this.twist(App.DIRECTION.DECREASE);
  }.bind(this));
  source.addEventListener('press', function(event) {
    this.startResetting();
  }.bind(this));
  source.addEventListener('release', function(event) {
    this.stopResetting();
  }.bind(this));

  this.setState(App.STATE.INITIALIZING);
    
  this.draw();
};

App.prototype.round = function(Wh) {
  var rounded = Math.round(Wh * 10) / 10;
  return Math.floor(rounded) + '.' + (rounded % 1 * 10);
};

App.prototype.updateUsed = function() {
  if (this.lastUsedUpdate == 0) {
    this.lastUsedUpdate = +new Date;
  } else {
    var now = +new Date;
    var millis = now - this.lastUsedUpdate;
    var watts = this.watts;
    for (var i = 0; i < this.watts.length; i++) {
      var add = watts[i] / 1000.0 / 3600.0;
      this.used[i] = (this.used[i] || 0) + add;
    }
    this.lastUsedUpdate = now;

    var total = this.used.reduce(sum);
    if (total > this.measure) {
      var factor = this.measure / total;
      this.used = this.used.map(function(Wh) { return Wh * factor; });
      this.end = +new Date;
      this.setState(App.STATE.FINISHED);
    }
  }
};

App.prototype.setState = function(state) {
  var name = Object.keys(App.STATE).filter(function(key, i) { return i == state; })[0];
  console.log('state:', name);
  this.previousState = this.state || App.STATE.IDLE;
  this.drawUtil.t0 = +new Date;
  this.state = state;
};

App.prototype.twist = function(direction) {
  if (direction == App.DIRECTION.DECREASE) var factor = -1;
  else if (direction == App.DIRECTION.INCREASE) var factor = 1;
  
  if (this.countdown) clearTimeout(this.countdown);
  
  this.measure += factor * this.config.watthour.step;
  if (this.measure < this.config.watthour.min) this.measure = this.config.watthour.min;
  if (this.measure > this.config.watthour.max) this.measure = this.config.watthour.max;
  
  if (this.state != App.STATE.WINDING) this.setState(App.STATE.WINDING);
  
  this.countdown = setTimeout(function() {
    delete this.firstData;
    this.used = this.config.colors.map(function() { return 0; });
    this.start = +new Date;
    this.setState(App.STATE.PROGRESS);
  }.bind(this), this.config.countdown);
};

App.prototype.startResetting = function() {
  if ((this.state == App.STATE.PROGRESS) ||
      (this.state == App.STATE.FINISHED)) {
    this.preResetState = this.state;
    this.setState(App.STATE.RESETTING);
  }
};

App.prototype.stopResetting = function() {
  if (this.state == App.STATE.RESETTING)
    this.setState(this.preResetState);
};

App.prototype.draw = function(t) {
  requestAnimationFrame(this.draw.bind(this));
  
  var changed = this.state != this.previousState;
  if (changed) {
    this.drawUtil.t0 = t;
    this.previousState = this.state;
  }
  
  var ctx = this.canvas.getContext('2d');

  ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.rect(0, 0, this.canvas.width, this.canvas.height);
  ctx.fillStyle = 'black';
  ctx.fill();

  this.draw[this.state].bind(this)(ctx, t, this.drawUtil);
};

App.prototype.draw[App.STATE.INITIALIZING] = function(ctx) {
  ctx.font = this.getFont(18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('initializing…', this.canvas.width / 2, this.canvas.height / 2);
};

App.prototype.draw[App.STATE.INTRO] = function(ctx, t, u) {
  var size = this.canvas.height / 2 - this.config.display.padding - this.config.display.lineWidth;
  
  ctx.beginPath();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = this.config.display.lineWidth;
  ctx.arc(u.cx, u.cy, size, 0, 2 * Math.PI, false);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(u.cx, u.cy);
  var angle = map(linear, t, u.t0, u.t0 + 7000, -Math.PI / 4, 7/4 * Math.PI);
  ctx.rotate(angle);
  ctx.font = this.getFont(18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('twist to start', 0, u.height / 2 - 3 * 18);
  ctx.restore();
};

App.prototype.draw[App.STATE.RESETTING] = function(ctx, t, u) {
  var elapsed = t - u.t0;
  var seconds = this.config.resetTiming.waitSeconds;
  var ms = seconds * 1000;

  if (elapsed >= ms) {
    this.setState(App.STATE.INTRO);
    return;
  }

  this.draw[this.preResetState].bind(this)(ctx, t, u);

  var appear = this.config.resetTiming.appearMs;
  var scale1 = (elapsed > appear) ? 1 : map(easeOutQuart, elapsed, 0, appear, 0, 1);
  var inner = 50;
  var size = this.getSizeForEnergy(this.measure || this.config.watthour.max);
  var perCircle = size / seconds;

  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.scale(scale1, scale1);

  var radius = Math.max(inner, (Math.floor(elapsed / 1000) + map(easeOutQuart, elapsed, 0, 1000, 0, 1)) * perCircle);
  ctx.beginPath();
  ctx.fillStyle = '#000';
  ctx.lineWidth = this.config.display.lineWidth;
  ctx.arc(0, 0, radius, 0, 2 * Math.PI, false);
  ctx.fill();

  for (var i = 0; i < seconds; i++) {
    ctx.beginPath();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = this.config.display.lineWidth;
    ctx.arc(0, 0, i * perCircle, 0, 2 * Math.PI, false);
    ctx.stroke();
  }

  if (elapsed > ms - appear) {
    var scale2 = map(easeOutQuart, elapsed - appear, 0, appear, 1, 0);
    ctx.scale(scale2, scale2);
  }
  ctx.font = this.getFont(18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('reset?', 0, 0);

  ctx.restore();
};

App.prototype.draw[App.STATE.WINDING] = function(ctx, t, u) {
  var size = this.getSizeForEnergy(this.measure);
  
  ctx.beginPath();
  ctx.fillStyle = '#fff';
  ctx.arc(u.cx, u.cy, size, 0, 2 * Math.PI, false);
  ctx.fill();
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = '#fff';
  ctx.font = this.getFont(18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(this.round(this.measure), 0, -(size));
  ctx.restore();
};

App.prototype.draw[App.STATE.PROGRESS] = function(ctx, t, u) {
  this.updateUsed();

  var size = this.getSizeForEnergy(this.measure);

  var left = (this.measure - this.used.reduce(sum)) / this.measure;
  
  ctx.beginPath();
  ctx.fillStyle = '#fff';
  ctx.moveTo(u.cx, u.cy);
  ctx.arc(u.cx, u.cy, size, 0, 2 * Math.PI, false);
  ctx.closePath();
  ctx.fill();

  this.drawSlices(ctx, t, u, size);

  var left = this.round(this.measure - this.used.reduce(sum));
  var total = this.round(this.measure);
  var text = left + ' of ' + total + ' Wh left';
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = '#fff';
  ctx.font = this.getFont(18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 0, -(size));
  ctx.restore();
};

App.prototype.draw[App.STATE.FINISHED] = function(ctx, t, u) {
  var size = this.getSizeForEnergy(this.measure);
  
  this.drawSlices(ctx, t, u, size);
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = '#fff';
  ctx.font = this.getFont(18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(this.round(this.measure), 0, -(size));
  ctx.restore();
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = '#000';
  ctx.font = this.getFont(10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Wh', 0, -(size) + 20);
  ctx.restore();
  
  var totalMinutes = (this.end - this.start) / 1000 / 60;
  var hours = Math.floor(totalMinutes / 60);
  var minutes = Math.round(totalMinutes % 60);
  var time = + hours + ':' + ((minutes < 10) ? '0' : '') + minutes;
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(5 * Math.PI / 4)
  ctx.fillStyle = '#fff';
  ctx.font = this.getFont(18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(time, 0, -(size));
  ctx.restore();
  
  ctx.save();
  ctx.translate(u.cx, u.cy);
  ctx.rotate(5 * Math.PI / 4)
  ctx.fillStyle = '#000';
  ctx.font = this.getFont(10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('hours', 0, -(size) + 20);
  ctx.restore();
};

App.prototype.drawSlices = function(ctx, t, u, size) {
  var angle = -Math.PI / 2;
  this.used.forEach(function(Wh, i) {
    var add = Wh / this.measure * 2 * Math.PI;
    ctx.beginPath();
    ctx.fillStyle = u.colors[i];
    ctx.moveTo(u.cx, u.cy);
    ctx.arc(u.cx, u.cy, size, angle, angle -= add, true);
    ctx.closePath();
    ctx.fill();
  }.bind(this));
};

App.prototype.getSizeForEnergy = function(energy) {
  var maxSize = this.canvas.height / 2 - this.config.display.padding - this.config.display.lineWidth;
  var minSize = this.config.display.minSize * maxSize;
  var maxEnergy = this.config.watthour.max;
  
  return minSize + (energy / maxEnergy) * (maxSize - minSize);
};

App.prototype.getFont = function(size) {
  //return size + 'pt HelveticaNeue-Bold';
  return 'bold ' + size + 'pt sans-serif';
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}
