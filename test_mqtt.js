require('dotenv').config();
const mqtt = require('mqtt');
const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});

client.on('connect', () => {
  console.log('Test client connected. Publishing...');
  client.publish(process.env.MQTT_TOPIC || 'sensor/ukuran-baju', JSON.stringify({
    device_id: "test-device",
    height: 172,
    chest: 96,
    waist: 84,
    shoulder: 45
  }));
  setTimeout(() => client.end(), 1000);
});
