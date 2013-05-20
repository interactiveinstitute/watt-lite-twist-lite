import plugwise
import plugwise.util
import serial
import time

class ForgivingCircle(plugwise.Circle):
  'Catches exceptions triggered by the plugwise methods by staying constant'
  
  def _forgive(value):
    def wrap(method):
      def wrapped(self, *args):
        try: return method(self, *args)
        except plugwise.exceptions.TimeoutException: error = 'timeout'
        except ValueError: error = 'unknown error'
        print '%s in %s for %s. using previous value' % (error, method.func_name, self.mac)
        return value
      return wrapped
    return wrap
  
  @_forgive(0)
  def get_power_usage(self):
    return super(ForgivingCircle, self).get_power_usage()
    
  @_forgive((0, 0, 0))
  def get_pulse_counters(self):
    return super(ForgivingCircle, self).get_pulse_counters()
  
  @_forgive({ 'last_logaddr': 0 })
  def get_info(self):
    return super(ForgivingCircle, self).get_info()

class EnergyCircle(ForgivingCircle):
  'Collects energy usage from a circle, assuming that .measure() is called at least hourly'
  
  accumulating = False
  
  def _hourly_pulses_to_kWh(self, pulses):
    corrected = self.pulse_correction(pulses, 3600)
    kWs = self.pulses_to_kWs(corrected)
    return kWs / 3600
    
  def get_historical_kWh_values(self, address):
    history = self.get_power_usage_history(address)
    return [kWs / 3600 for time, kWs in history if time is not None]

  def get_last_log_address(self):
    return self.get_info()['last_logaddr']
    
  def get_current_hourly_pulses(self):
    return self.get_pulse_counters()[2]
  
  def measure(self):
    pulses = self.get_current_hourly_pulses()
    address = self.get_last_log_address()
    history = self.get_historical_kWh_values(address)
        
    if not self.accumulating:
      self.previous_kWh = -self._hourly_pulses_to_kWh(pulses)
      self.accumulating = True
    elif history != self.last_historical_values:
      if address == self.last_log_address:
        self.previous_kWh += history[-1]
      else:
        previous_values = self.get_historical_kWh_values(self.last_log_address)
        self.previous_kWh += previous_values[-1]

    self.current_pulses = pulses
    self.last_log_address = address
    self.last_historical_values = history
      
  def get_total_kWh(self):
    self.measure()
    value = self.previous_kWh + self._hourly_pulses_to_kWh(self.current_pulses)
    return max(value, 0)

class EnergyWatch(object):
  'Returns the accumulated energy in the configured circles on  .measure()'
  circles = []
  
  def __init__(self, config):    
    self.config = config
    
    stick = plugwise.Stick(config.STICK_PORT)
    
    for address in config.CIRCLES.keys():
      self.circles.append(EnergyCircle(address, stick))
      
  def measure(self):
    return [circle.get_total_kWh() for circle in self.circles]

if __name__ == '__main__':
  import tornado.ioloop
  
  import config
  
  watch = EnergyWatch(config)
  
  def debug():
    print ['%.10f' % val for val in watch.measure()]
  
  loop = tornado.ioloop.IOLoop.instance()
  tornado.ioloop.PeriodicCallback(debug, config.MEASURE_INTERVAL, loop).start()
  
  try: loop.start()
  except KeyboardInterrupt: print
