import fs from 'fs';
import path from 'path';
import * as ip2region from 'ip2region-ts';

const dbPath = './data/ip2region.xdb';
const DB_URL = 'https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb';

let searcherInstance = null;

// Download the ip2region.xdb file if not present
export async function initGeoIP() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size < 100000) {
    console.log('Downloading ip2region.xdb offline IP database from CDN...');
    try {
      const response = await fetch(DB_URL);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(dbPath, Buffer.from(buffer));
      console.log('ip2region.xdb downloaded successfully!');
    } catch (error) {
      console.error('Failed to download ip2region.xdb from CDN, using dummy lookup:', error.message);
    }
  }

  try {
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 100000) {
      // Load content into memory for fast lookup
      searcherInstance = ip2region.newWithBuffer(fs.readFileSync(dbPath));
      console.log('GeoIP Searcher initialized with memory buffer.');
    }
  } catch (error) {
    console.error('Error initializing ip2region Searcher:', error);
  }
}

/**
 * Geolocate an IP address
 * @param {string} ip 
 * @returns {Promise<{region: string, isp: string}>}
 */
export async function lookupIP(ip) {
  if (!searcherInstance) {
    return { region: '未知', isp: '未知' };
  }

  // Basic IPv4 extraction (handle IPv6 mapped IPv4 like ::ffff:1.2.3.4)
  let cleanIp = ip.trim();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.substring(7);
  }

  // Check if it is a valid IPv4
  const ipv4Regex = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (!ipv4Regex.test(cleanIp)) {
    return { region: cleanIp.includes(':') ? 'IPv6网络' : '本地局域网', isp: '未知' };
  }

  try {
    const result = await searcherInstance.search(cleanIp);
    if (!result) {
      return { region: '未知', isp: '未知' };
    }

    // Format is: 国家|区域|省份|城市|ISP
    const parts = result.split('|');
    if (parts.length < 5) {
      return { region: '未知', isp: '未知' };
    }

    const country = parts[0] === '0' ? '' : parts[0];
    const province = parts[2] === '0' ? '' : parts[2];
    const city = parts[3] === '0' ? '' : parts[3];
    const isp = parts[4] === '0' ? '未知' : parts[4];

    let region = '';
    if (province && city) {
      region = province === city ? province : `${province}${city}`;
    } else {
      region = province || city || country || '未知';
    }

    return { region, isp };
  } catch (error) {
    return { region: '未知', isp: '未知' };
  }
}
