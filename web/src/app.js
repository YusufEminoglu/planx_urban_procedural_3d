/* app.js - PlanX Urban Procedural 3D */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Application State
let scene, camera, renderer, controls;
let raycaster, mouse;
let parcelFeatures = []; // Array of { fid, properties, outerRing, parcelMesh, buildingMesh, setbackMesh, sidewalkMesh, zoningMesh, area, params }
let selectedParcel = null;

// Traffic State
let trafficCars = []; // Array of { carMesh, roadRing, speed, progress }

// Light references
let dirLight, ambientLight;

// Projection variables (local offset)
let centerX = 0;
let centerY = 0;

// Setup UI Element references
const loadingEl = document.getElementById('loading');
const placeholderEl = document.getElementById('selection-placeholder');
const controlsEl = document.getElementById('editor-controls');
const btnSync = document.getElementById('btn-sync');
const btnCapture = document.getElementById('btn-capture');

// Input controls
const inTypology = document.getElementById('input-typology');
const inUsage = document.getElementById('input-usage');
const inSetback = document.getElementById('input-setback');
const inFloors = document.getElementById('input-floors');
const inFloorHeight = document.getElementById('input-floorheight');
const inMaxBcr = document.getElementById('input-max-bcr');
const inMaxFar = document.getElementById('input-max-far');
const inMaxHeight = document.getElementById('input-max-height');
const inTime = document.getElementById('input-time');

// Label values
const lblSetback = document.getElementById('val-setback');
const lblFloors = document.getElementById('val-floors');
const lblFloorHeight = document.getElementById('val-floorheight');
const lblMaxBcr = document.getElementById('val-max-bcr');
const lblMaxFar = document.getElementById('val-max-far');
const lblMaxHeight = document.getElementById('val-max-height');
const lblTime = document.getElementById('val-time');

// Metrics
const metFid = document.getElementById('prop-fid');
const metArea = document.getElementById('prop-area');
const metFootprint = document.getElementById('metric-footprint');
const metGfa = document.getElementById('metric-gfa');
const metHeight = document.getElementById('metric-height');
const metBcrLabel = document.getElementById('metric-bcr-label');
const metFarLabel = document.getElementById('metric-far-label');
const metStatus = document.getElementById('metric-status');

// Gauge elements
const bcrFillEl = document.getElementById('gauge-bcr-fill');
const farFillEl = document.getElementById('gauge-far-fill');

// HUD
const hudTotalParcels = document.getElementById('hud-total-parcels');
const hudCrs = document.getElementById('hud-crs');

// Initialize the 3D scene
function init() {
    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 180, 280);

    // 3. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('viewport').appendChild(renderer.domElement);

    // 4. OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // 5. Lighting
    ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(200, 450, 150);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 1200;
    
    const d = 600;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Grid Floor
    const grid = new THREE.GridHelper(1200, 120, 0x1e293b, 0x0f172a);
    grid.position.y = -0.05;
    scene.add(grid);

    // Build Solar Orbit Arc
    const arcPoints = [];
    const radius = 500;
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI; // 0 to 180 degrees
        const x = Math.cos(theta + Math.PI) * radius;
        const y = Math.sin(theta) * radius;
        const z = 100;
        arcPoints.push(new THREE.Vector3(x, y, z));
    }
    const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineDashedMaterial({
        color: 0xeab308,
        dashSize: 10,
        gapSize: 8,
        transparent: true,
        opacity: 0.35
    });
    const solarArc = new THREE.Line(arcGeom, arcMat);
    solarArc.computeLineDistances();
    scene.add(solarArc);
    window.solarArc = solarArc;

    // Build Sun/Moon Sphere
    const sunSphereGeom = new THREE.SphereGeometry(10, 16, 16);
    const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const sunSphere = new THREE.Mesh(sunSphereGeom, sunSphereMat);
    scene.add(sunSphere);
    window.sunSphere = sunSphere;

    // 6. Interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    window.addEventListener('click', onDocumentClick);
    window.addEventListener('resize', onWindowResize);

    setupInputListeners();

    // 7. Load Data
    loadGeoJSON();

    animate();
}

// Render loop
function animate() {
    requestAnimationFrame(animate);
    
    // Update controls
    controls.update();

    // Update traffic cars positions
    updateTraffic();

    // Beacon light blinking animation
    const timeSec = Date.now() * 0.005;
    scene.traverse(child => {
        if (child.userData && child.userData.isBeacon) {
            child.material.opacity = 0.2 + Math.abs(Math.sin(timeSec * 2)) * 0.8;
        }
    });

    renderer.render(scene, camera);
}

// Resize handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Set up UI input controls event handlers
function setupInputListeners() {
    const triggerUpdate = () => {
        if (!selectedParcel) return;
        
        // Read slider values
        selectedParcel.params.setback = parseFloat(inSetback.value);
        selectedParcel.params.floors = parseInt(inFloors.value);
        selectedParcel.params.floorHeight = parseFloat(inFloorHeight.value);
        selectedParcel.params.typology = inTypology.value;
        selectedParcel.params.usage = inUsage.value;
        
        // Zoning limits
        selectedParcel.params.maxBcr = parseFloat(inMaxBcr.value);
        selectedParcel.params.maxFar = parseFloat(inMaxFar.value);
        selectedParcel.params.maxHeight = parseFloat(inMaxHeight.value);

        // Update labels
        lblSetback.textContent = selectedParcel.params.setback.toFixed(1);
        lblFloors.textContent = selectedParcel.params.floors;
        lblFloorHeight.textContent = selectedParcel.params.floorHeight.toFixed(1);
        lblMaxBcr.textContent = selectedParcel.params.maxBcr.toFixed(2);
        lblMaxFar.textContent = selectedParcel.params.maxFar.toFixed(1);
        lblMaxHeight.textContent = selectedParcel.params.maxHeight.toFixed(1);

        // Rebuild meshes
        rebuildParcel3D(selectedParcel);
        updateDashboard(selectedParcel);
    };

    const triggerTimeUpdate = () => {
        const tVal = parseFloat(inTime.value);
        const hours = Math.floor(tVal);
        const mins = (tVal % 1) === 0 ? "00" : "30";
        lblTime.textContent = `${hours}:${mins}`;

        updateSolarPhysics(tVal);
    };

    inSetback.addEventListener('input', triggerUpdate);
    inFloors.addEventListener('input', triggerUpdate);
    inFloorHeight.addEventListener('input', triggerUpdate);
    inTypology.addEventListener('change', triggerUpdate);
    inUsage.addEventListener('change', triggerUpdate);
    
    // Zoning inputs
    inMaxBcr.addEventListener('input', triggerUpdate);
    inMaxFar.addEventListener('input', triggerUpdate);
    inMaxHeight.addEventListener('input', triggerUpdate);

    // Time-of-day slider
    inTime.addEventListener('input', triggerTimeUpdate);

    btnSync.addEventListener('click', syncToQGIS);
    btnCapture.addEventListener('click', captureViewport);
}

// Update lights and sky theme based on solar time of day
function updateSolarPhysics(timeVal) {
    // Math model of sun orbit path
    const angle = ((timeVal - 6) / 16) * Math.PI; // map 6:00-22:00 to 0-180 degrees
    const isNight = timeVal < 7.5 || timeVal > 19.5;

    // Dome Orbit position
    const radius = 500;
    dirLight.position.x = Math.cos(angle + Math.PI) * radius;
    dirLight.position.y = Math.sin(angle) * radius;
    dirLight.position.z = 100;

    // Update Sun/Moon sphere mesh
    if (window.sunSphere) {
        window.sunSphere.position.copy(dirLight.position);
        if (isNight) {
            window.sunSphere.material.color.setHex(0xe2e8f0); // silver moon
            window.sunSphere.scale.setScalar(0.75);
        } else {
            window.sunSphere.material.color.setHex(0xfef08a); // glowing yellow sun
            window.sunSphere.scale.setScalar(1.0);
        }
    }

    if (isNight) {
        // Switch to Dark Midnight Scene background
        scene.background.setHex(0x02040a);
        ambientLight.color.setHex(0x1e1b4b); // Dim indigo light
        ambientLight.intensity = 0.25;
        dirLight.intensity = 0.05; // Dim moon-like sun
    } else {
        // Daylight Mode
        scene.background.setHex(0x0a0e17);
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 0.45;
        
        // Solar intensity peaks at noon
        const peakFactor = Math.sin(angle);
        dirLight.intensity = 0.35 + peakFactor * 0.55;
    }

    // Update active building emission light and streetlights visibility
    parcelFeatures.forEach(item => {
        // Toggle building window glow at night
        if (item.buildingMesh) {
            item.buildingMesh.traverse(child => {
                if (child.isMesh && Array.isArray(child.material)) {
                    const wallMaterial = child.material[1];
                    if (wallMaterial && wallMaterial.emissiveMap) {
                        wallMaterial.emissiveIntensity = isNight ? 1.0 : 0.0;
                    }
                }
            });
        }

        // Toggle streetlight bulb visibility
        if (item.sidewalkMesh) {
            item.sidewalkMesh.traverse(child => {
                if (child.userData && child.userData.isStreetlightBulb) {
                    child.visible = isNight;
                }
            });
        }
    });

    // Toggle headlights on traffic cars
    trafficCars.forEach(car => {
        car.carMesh.traverse(child => {
            if (child.userData && (child.userData.isHeadlight || child.userData.isTaillight)) {
                child.visible = isNight;
            }
        });
    });
}

// Fetch exported layer GeoJSON from local Python server
async function loadGeoJSON() {
    try {
        const response = await fetch('/data.geojson');
        if (!response.ok) throw new Error("Could not load data");
        
        const data = await response.json();
        parseGeoJSON(data);
        
        loadingEl.style.opacity = 0;
        setTimeout(() => loadingEl.classList.add('hidden'), 500);
    } catch (e) {
        console.error(e);
        document.getElementById('loading-text').innerText = "ERROR: Failed to load layer. Verify QGIS server connection.";
    }
}

// Parse GeoJSON geometries and center coordinates
function parseGeoJSON(data) {
    if (!data.features || data.features.length === 0) return;

    hudTotalParcels.textContent = data.features.length;
    if (data.crs && data.crs.properties && data.crs.properties.name) {
        const crsName = data.crs.properties.name.split("::").pop();
        hudCrs.textContent = crsName;
    }

    // 1. Calculate bounding box center
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.features.forEach(f => {
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) return;
        
        const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        rings.forEach(ring => {
            ring[0].forEach(coord => {
                if (coord[0] < minX) minX = coord[0];
                if (coord[0] > maxX) maxX = coord[0];
                if (coord[1] < minY) minY = coord[1];
                if (coord[1] > maxY) maxY = coord[1];
            });
        });
    });

    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;

    // 2. Parse features
    data.features.forEach((f, idx) => {
        if (!f.geometry) return;
        const fid = f.id !== undefined ? f.id : idx;
        const props = f.properties || {};

        let coords = [];
        if (f.geometry.type === 'Polygon') {
            coords = f.geometry.coordinates[0];
        } else if (f.geometry.type === 'MultiPolygon') {
            coords = f.geometry.coordinates[0][0];
        }

        if (!coords || coords.length < 3) return;

        // Convert coordinates to local meters
        const localPoints = coords.map(pt => {
            return { x: pt[0] - centerX, y: pt[1] - centerY };
        });

        // Calculate parcel area
        const area = calculatePolygonArea(localPoints);

        // Initial params (fall back to layer attributes if existing)
        const params = {
            setback: props.setback !== undefined ? parseFloat(props.setback) : 3.0,
            floors: props.floors !== undefined ? parseInt(props.floors) : 4,
            floorHeight: props.floor_h !== undefined ? parseFloat(props.floor_h) : (props.floor_height !== undefined ? parseFloat(props.floor_height) : 3.0),
            typology: props.typology !== undefined ? props.typology : 'Tower',
            usage: props.usage !== undefined ? props.usage : 'Residential',
            // Zoning constraints
            maxBcr: props.max_bcr !== undefined ? parseFloat(props.max_bcr) : 0.45,
            maxFar: props.max_far !== undefined ? parseFloat(props.max_far) : 2.5,
            maxHeight: props.max_height !== undefined ? parseFloat(props.max_height) : 18.0
        };

        const item = {
            fid,
            properties: props,
            outerRing: localPoints,
            area,
            params,
            parcelMesh: null,
            buildingMesh: null,
            setbackMesh: null,
            sidewalkMesh: null,
            zoningMesh: null
        };

        buildParcelGround(item);
        buildSidewalk(item);
        rebuildParcel3D(item);
        
        parcelFeatures.push(item);
    });

    // Generate Animated Traffic on road tracks
    generateTrafficCars();

    // Zoom camera to fit parcels bounds
    const maxDim = Math.max(maxX - minX, maxY - minY);
    camera.position.set(0, maxDim * 0.8, maxDim * 1.2);
    controls.target.set(0, 0, 0);
    controls.update();
}

// Render parcel boundary lines and ground surface
function buildParcelGround(item) {
    const shape = new THREE.Shape();
    item.outerRing.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt.x, pt.y);
        else shape.lineTo(pt.x, pt.y);
    });

    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.userData = { parcelItem: item };
    scene.add(mesh);
    item.parcelMesh = mesh;

    // Draw boundary line
    const borderPoints = item.outerRing.map(pt => new THREE.Vector3(pt.x, 0.05, -pt.y));
    borderPoints.push(borderPoints[0].clone());
    
    const lineGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 2 });
    const line = new THREE.Line(lineGeom, lineMat);
    scene.add(line);
}

// Build concrete sidewalk and place procedural streetlights along curbs
function buildSidewalk(item) {
    if (item.sidewalkMesh) {
        scene.remove(item.sidewalkMesh);
        item.sidewalkMesh.geometry.dispose();
    }

    // Outer sidewalk polygon (shifted 2.0 meters outward)
    const outerSidewalk = offsetPolygonRing(item.outerRing, -2.0);
    if (!outerSidewalk) return;

    const shape = new THREE.Shape();
    outerSidewalk.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt.x, pt.y);
        else shape.lineTo(pt.x, pt.y);
    });

    // Subtract parcel shape to make a frame
    const hole = new THREE.Path();
    item.outerRing.forEach((pt, i) => {
        if (i === 0) hole.moveTo(pt.x, pt.y);
        else hole.lineTo(pt.x, pt.y);
    });
    shape.holes.push(hole);

    // Extrude sidewalk by 0.15m height
    const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x52525b, // concrete grey
        roughness: 0.8
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.position.y = -0.05;
    scene.add(mesh);
    item.sidewalkMesh = mesh;

    // Place Procedural Streetlights along curb corners
    const numLights = Math.max(2, Math.floor(item.outerRing.length / 2));
    const step = Math.floor(item.outerRing.length / numLights);

    for (let i = 0; i < numLights; i++) {
        const idx = (i * step) % item.outerRing.length;
        const pt = item.outerRing[idx];
        
        // Offset light/tree slightly outwards onto sidewalk
        const ptNext = item.outerRing[(idx + 1) % item.outerRing.length];
        const dx = ptNext.x - pt.x;
        const dy = ptNext.y - pt.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.01) continue;
        const nx = -dy / len;
        const ny = dx / len;

        const lx = pt.x + nx * 1.0;
        const lz = - (pt.y + ny * 1.0);

        if (i % 2 === 0) {
            // Build streetlight pole
            const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 6, 8);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.8 });
            const pole = new THREE.Mesh(poleGeom, poleMat);
            pole.position.set(lx, 3, lz);
            pole.castShadow = true;
            mesh.add(pole);

            // Lamp head Arm
            const armGeom = new THREE.BoxGeometry(0.2, 0.2, 1.5);
            const arm = new THREE.Mesh(armGeom, poleMat);
            arm.position.set(0, 3, 0.5);
            pole.add(arm);

            // Glowing light bulb (only visible at night)
            const bulbGeom = new THREE.SphereGeometry(0.3, 16, 16);
            const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
            const bulb = new THREE.Mesh(bulbGeom, bulbMat);
            bulb.position.set(0, 2.8, 1.2);
            bulb.userData = { isStreetlightBulb: true };
            bulb.visible = false; // off by default (daylight)
            pole.add(bulb);

            // Spot light source casting downward
            const spotLight = new THREE.SpotLight(0xfef08a, 4, 15, Math.PI / 4, 0.5, 1);
            spotLight.position.set(0, 2.7, 1.2);
            spotLight.target.position.set(0, 0, 1.2);
            bulb.add(spotLight);
            bulb.add(spotLight.target);
        } else {
            // Plant a beautiful sidewalk tree
            const tree = buildLowPolyTree(lx, 0.15, lz, 4 + Math.random() * 2);
            mesh.add(tree);
        }
    }
}

// Rebuild building massing, zoning envelopes, and setback lines based on params
function rebuildParcel3D(item) {
    // 1. Clear old models
    if (item.buildingMesh) {
        scene.remove(item.buildingMesh);
        item.buildingMesh.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else if (child.material) {
                    child.material.dispose();
                }
            }
        });
        item.buildingMesh = null;
    }
    if (item.setbackMesh) {
        scene.remove(item.setbackMesh);
        item.setbackMesh.geometry.dispose();
        item.setbackMesh = null;
    }
    if (item.zoningMesh) {
        scene.remove(item.zoningMesh);
        item.zoningMesh.geometry.dispose();
        item.zoningMesh = null;
    }

    const setback = item.params.setback;
    const floors = item.params.floors;
    const floorH = item.params.floorHeight;
    const height = floors * floorH;
    const typology = item.params.typology;
    const usage = item.params.usage;

    // 2. Generate Inset Setback Shape
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    if (!insetRing || insetRing.length < 3) {
        drawSetbackErrorLine(item);
        return;
    }

    // Draw setback guideline
    const setbackPoints = insetRing.map(pt => new THREE.Vector3(pt.x, 0.1, -pt.y));
    setbackPoints.push(setbackPoints[0].clone());
    const sbGeom = new THREE.BufferGeometry().setFromPoints(setbackPoints);
    const sbMat = new THREE.LineDashedMaterial({ color: 0x14b8a6, dashSize: 2, gapSize: 1.5 });
    const sbLine = new THREE.Line(sbGeom, sbMat);
    sbLine.computeLineDistances();
    scene.add(sbLine);
    item.setbackMesh = sbLine;

    // Calculate footprint area and construct shape/geometry
    let footprintArea = 0;
    let gfa = 0;
    let bldGeom = null;
    let bldMesh = null;
    let footprintPoints = [];

    // Check if usage is Park
    if (usage === 'Park') {
        const parkGroup = new THREE.Group();
        parkGroup.userData = { parcelItem: item };
        scene.add(parkGroup);
        item.buildingMesh = parkGroup;

        // Draw green turf shape
        const turfShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) turfShape.moveTo(pt.x, pt.y);
            else turfShape.lineTo(pt.x, pt.y);
        });
        const turfGeom = new THREE.ExtrudeGeometry(turfShape, { depth: 0.1, bevelEnabled: false });
        turfGeom.rotateX(-Math.PI / 2);
        const turfMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 });
        const turfMesh = new THREE.Mesh(turfGeom, turfMat);
        turfMesh.receiveShadow = true;
        turfMesh.position.y = 0.02;
        parkGroup.add(turfMesh);

        // Add walking path: a gravel circle or oval in the center
        let cx = 0, cy = 0;
        insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
        cx /= insetRing.length;
        cy /= insetRing.length;

        const pathGeom = new THREE.TorusGeometry(8, 1.5, 8, 24);
        pathGeom.rotateX(Math.PI / 2);
        const pathMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.8 });
        const pathMesh = new THREE.Mesh(pathGeom, pathMat);
        pathMesh.position.set(cx, 0.13, -cy);
        pathMesh.receiveShadow = true;
        parkGroup.add(pathMesh);

        // Add 2 wooden benches around path
        const benchGeom = new THREE.BoxGeometry(2.5, 0.4, 0.6);
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
        const legGeom = new THREE.BoxGeometry(0.2, 0.4, 0.6);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.8 });

        const benchOffsets = [
            { x: cx - 6, z: -cy - 6, rot: Math.PI / 4 },
            { x: cx + 6, z: -cy + 6, rot: 5 * Math.PI / 4 }
        ];

        benchOffsets.forEach(offset => {
            const bench = new THREE.Group();
            bench.position.set(offset.x, 0.2, offset.z);
            bench.rotation.y = offset.rot;
            
            const seat = new THREE.Mesh(benchGeom, benchMat);
            seat.position.y = 0.2;
            seat.castShadow = true;
            bench.add(seat);

            const leg1 = new THREE.Mesh(legGeom, legMat);
            leg1.position.set(-1.0, 0, 0);
            leg1.castShadow = true;
            bench.add(leg1);

            const leg2 = new THREE.Mesh(legGeom, legMat);
            leg2.position.set(1.0, 0, 0);
            leg2.castShadow = true;
            bench.add(leg2);

            parkGroup.add(bench);
        });

        // Add clustered park trees
        const numParkTrees = Math.min(6, Math.max(3, Math.floor(item.area / 200)));
        for (let i = 0; i < numParkTrees; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * 8;
            const tx = cx + Math.cos(angle) * dist;
            const tz = -cy + Math.sin(angle) * dist;
            
            const tree = buildLowPolyTree(tx, 0.1, tz, 4 + Math.random() * 3);
            parkGroup.add(tree);
        }

        buildZoningEnvelope(item, insetRing, item.params.maxHeight, false);
        return;
    }

    // Otherwise, generate building based on Typology
    if (typology === 'Courtyard') {
        const innerSetback = 8;
        const innerRing = offsetPolygonRing(insetRing, innerSetback);
        const outerArea = calculatePolygonArea(insetRing);
        const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
        footprintArea = Math.max(0, outerArea - innerArea);
        gfa = footprintArea * floors;

        const bldShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) bldShape.moveTo(pt.x, pt.y);
            else bldShape.lineTo(pt.x, pt.y);
        });
        if (innerRing && innerRing.length >= 3) {
            const hole = new THREE.Path();
            innerRing.forEach((pt, i) => {
                if (i === 0) hole.moveTo(pt.x, pt.y);
                else hole.lineTo(pt.x, pt.y);
            });
            bldShape.holes.push(hole);
        }
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = insetRing; // approximate pitched roof edge
    } else if (typology === 'Slab') {
        const slabShape = buildSlabShape(insetRing, 12);
        footprintArea = calculateShapeArea(slabShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(slabShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = slabShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'LShape') {
        const lShape = buildLShape(insetRing, 12);
        footprintArea = calculateShapeArea(lShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(lShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = lShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'UShape') {
        const uShape = buildUShape(insetRing, 12);
        footprintArea = calculateShapeArea(uShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(uShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = uShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'PodiumTower') {
        const podiumH = Math.min(height, 2 * floorH);
        const towerH = Math.max(0, height - podiumH);

        const podiumArea = calculatePolygonArea(insetRing);
        const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
        const towerArea = calculatePolygonArea(towerRing);

        const podiumFloors = Math.round(podiumH / floorH);
        const towerFloors = Math.round(towerH / floorH);

        footprintArea = podiumArea;
        gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);

        // Build Podium Mesh
        const podiumShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) podiumShape.moveTo(pt.x, pt.y);
            else podiumShape.lineTo(pt.x, pt.y);
        });
        const podiumGeom = new THREE.ExtrudeGeometry(podiumShape, { depth: podiumH, bevelEnabled: false });
        podiumGeom.rotateX(-Math.PI / 2);
        podiumGeom.translate(0, podiumH, 0);

        const matsPodium = getBuildingMaterials(usage, podiumFloors);
        const podiumMesh = new THREE.Mesh(podiumGeom, matsPodium);
        podiumMesh.castShadow = true;
        podiumMesh.receiveShadow = true;

        // Build Tower Mesh
        let towerMesh = null;
        if (towerH > 0) {
            const towerShape = new THREE.Shape();
            towerRing.forEach((pt, i) => {
                if (i === 0) towerShape.moveTo(pt.x, pt.y);
                else towerShape.lineTo(pt.x, pt.y);
            });
            const towerGeom = new THREE.ExtrudeGeometry(towerShape, { depth: towerH, bevelEnabled: false });
            towerGeom.rotateX(-Math.PI / 2);
            towerGeom.translate(0, height, 0);

            const matsTower = getBuildingMaterials(usage, towerFloors);
            towerMesh = new THREE.Mesh(towerGeom, matsTower);
            towerMesh.castShadow = true;
            towerMesh.receiveShadow = true;
        }

        const group = new THREE.Group();
        group.userData = { parcelItem: item };
        group.add(podiumMesh);
        if (towerMesh) group.add(towerMesh);
        scene.add(group);
        item.buildingMesh = group;

        // Add flat roof details on top
        addRooftopDetails(towerMesh || podiumMesh, towerRing, height, usage);

        footprintPoints = towerRing; // for compliance envelope
    } else { // Tower
        footprintArea = calculatePolygonArea(insetRing);
        gfa = footprintArea * floors;

        const bldShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) bldShape.moveTo(pt.x, pt.y);
            else bldShape.lineTo(pt.x, pt.y);
        });
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = insetRing;
    }

    // Standard single-mesh building construction (except PodiumTower which exits/adds directly)
    if (typology !== 'PodiumTower') {
        const mats = getBuildingMaterials(usage, floors);
        bldMesh = new THREE.Mesh(bldGeom, mats);
        bldMesh.castShadow = true;
        bldMesh.receiveShadow = true;
        bldMesh.userData = { parcelItem: item };
        scene.add(bldMesh);
        item.buildingMesh = bldMesh;

        // Add Rooftop Details (Pitched roof for Residential Tower, Slab, L, U; flat otherwise)
        if (usage === 'Residential' && typology !== 'Courtyard') {
            buildPitchedRoof(bldMesh, footprintPoints, height);
        } else {
            addRooftopDetails(bldMesh, footprintPoints, height, usage);
        }

        // Add Courtyard/Inner garden trees for specific typologies
        if (typology === 'Courtyard') {
            let cx = 0, cy = 0;
            insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
            cx /= insetRing.length;
            cy /= insetRing.length;
            
            const courtTree = buildLowPolyTree(cx, 0.05, -cy, 6);
            bldMesh.add(courtTree);
        } else if (typology === 'LShape') {
            const ob = getOrientedBounds(insetRing);
            const w = Math.min(12, ob.W * 0.5);
            const h = Math.min(12, ob.H * 0.5);
            const px = ob.maxX - (ob.W - w) / 2;
            const py = ob.maxY - (ob.H - h) / 2;
            const gx = ob.cx + px * ob.ux + py * ob.nx;
            const gy = ob.cy + px * ob.uy + py * ob.ny;
            
            const courtTree = buildLowPolyTree(gx, 0.05, -gy, 5);
            bldMesh.add(courtTree);
        } else if (typology === 'UShape') {
            const ob = getOrientedBounds(insetRing);
            const w = Math.min(12, ob.W * 0.4);
            const h = Math.min(12, ob.H * 0.4);
            const px = (ob.minX + ob.maxX) / 2;
            const py = ob.maxY - (ob.H - h) / 2;
            const gx = ob.cx + px * ob.ux + py * ob.nx;
            const gy = ob.cy + px * ob.uy + py * ob.ny;
            
            const courtTree = buildLowPolyTree(gx, 0.05, -gy, 5);
            bldMesh.add(courtTree);
        }
    }

    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Check violations
    const heightViolation = height > item.params.maxHeight;
    const bcrViolation = bcr > item.params.maxBcr;
    const farViolation = far > item.params.maxFar;
    const hasViolation = heightViolation || bcrViolation || farViolation;

    // 3. Build Zoning Envelope
    buildZoningEnvelope(item, insetRing, item.params.maxHeight, hasViolation);
}

// ───────────────────────── Low Poly Procedural Vegetation ─────────────────────────
function buildLowPolyTree(x, y, z, height) {
    const treeGroup = new THREE.Group();
    treeGroup.position.set(x, y, z);

    const trunkHeight = height * 0.35;
    const trunkRadius = trunkHeight * 0.12;
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    const foliageHeight = height * 0.65;
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.8 });
    
    // Stacked cones for a neat procedural tree model
    const numLayers = 3;
    for (let l = 0; l < numLayers; l++) {
        const radius = foliageHeight * 0.5 * (1 - l * 0.25);
        const coneGeom = new THREE.ConeGeometry(radius, foliageHeight * 0.5, 8);
        const cone = new THREE.Mesh(coneGeom, foliageMat);
        cone.position.y = trunkHeight + (l * foliageHeight * 0.22) + (foliageHeight * 0.25);
        cone.castShadow = true;
        treeGroup.add(cone);
    }

    return treeGroup;
}

// ───────────────────────── Oriented Bounding Box Helpers ─────────────────────────
function getOrientedBounds(ring) {
    let maxLen = -1;
    let bestStart = null, bestEnd = null;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > maxLen) {
            maxLen = len;
            bestStart = p1;
            bestEnd = p2;
        }
    }

    let cx = 0, cy = 0;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= N;
    cy /= N;

    const dx = bestEnd.x - bestStart.x;
    const dy = bestEnd.y - bestStart.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy;
    const ny = ux;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    ring.forEach(pt => {
        const rx = pt.x - cx;
        const ry = pt.y - cy;
        const projX = rx * ux + ry * uy;
        const projY = rx * nx + ry * ny;
        if (projX < minX) minX = projX;
        if (projX > maxX) maxX = projX;
        if (projY < minY) minY = projY;
        if (projY > maxY) maxY = projY;
    });

    return {
        cx, cy,
        ux, uy,
        nx, ny,
        minX, maxX,
        minY, maxY,
        W: maxX - minX,
        H: maxY - minY
    };
}

function buildLShape(ring, width) {
    const ob = getOrientedBounds(ring);
    
    const w = Math.min(width, ob.W * 0.5);
    const h = Math.min(width, ob.H * 0.5);

    const shape = new THREE.Shape();
    
    const ptsLocal = [
        { x: ob.minX, y: ob.minY },
        { x: ob.maxX, y: ob.minY },
        { x: ob.maxX, y: ob.minY + h },
        { x: ob.minX + w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.maxY },
        { x: ob.minX, y: ob.maxY }
    ];

    ptsLocal.forEach((pt, i) => {
        const gx = ob.cx + pt.x * ob.ux + pt.y * ob.nx;
        const gy = ob.cy + pt.x * ob.uy + pt.y * ob.ny;
        if (i === 0) shape.moveTo(gx, gy);
        else shape.lineTo(gx, gy);
    });

    return shape;
}

function buildUShape(ring, width) {
    const ob = getOrientedBounds(ring);
    
    const w = Math.min(width, ob.W * 0.4);
    const h = Math.min(width, ob.H * 0.4);

    const shape = new THREE.Shape();

    const ptsLocal = [
        { x: ob.minX, y: ob.maxY },
        { x: ob.minX, y: ob.minY },
        { x: ob.maxX, y: ob.minY },
        { x: ob.maxX, y: ob.maxY },
        { x: ob.maxX - w, y: ob.maxY },
        { x: ob.maxX - w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.maxY }
    ];

    ptsLocal.forEach((pt, i) => {
        const gx = ob.cx + pt.x * ob.ux + pt.y * ob.nx;
        const gy = ob.cy + pt.x * ob.uy + pt.y * ob.ny;
        if (i === 0) shape.moveTo(gx, gy);
        else shape.lineTo(gx, gy);
    });

    return shape;
}

// Generate textured building materials with window grids dynamically
// Generate textured building materials with window grids dynamically
function getBuildingMaterials(usage, floors) {
    let colorHex = '#e2e8f0';
    if (usage === 'Residential') {
        colorHex = '#b45309'; // warm corporate amber-brown
    } else if (usage === 'Commercial') {
        colorHex = '#0f172a'; // dark steel corporate facade
    } else if (usage === 'Civic') {
        colorHex = '#334155'; // professional slate civic facade
    }

    const textures = createFacadeTextures(colorHex, usage);
    textures.map.repeat.set(6, floors);
    textures.emissiveMap.repeat.set(6, floors);

    const tVal = parseFloat(inTime.value);
    const isNight = tVal < 7.5 || tVal > 19.5;

    const wallMat = new THREE.MeshStandardMaterial({
        map: textures.map,
        emissiveMap: textures.emissiveMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: isNight ? 1.0 : 0.0,
        roughness: 0.4,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85
    });

    const roofMat = new THREE.MeshStandardMaterial({
        color: 0x334155, // concrete grey roof
        roughness: 0.8
    });

    return [roofMat, wallMat];
}

// Canvas-drawn texture mapping for realistic windows with randomized emissive maps
function createFacadeTextures(wallColor, usage) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const emCanvas = document.createElement('canvas');
    emCanvas.width = 256;
    emCanvas.height = 256;
    const emCtx = emCanvas.getContext('2d');

    // Draw base wall
    ctx.fillStyle = wallColor;
    ctx.fillRect(0, 0, 256, 256);

    // Emissive base is black (no glow on walls)
    emCtx.fillStyle = '#000000';
    emCtx.fillRect(0, 0, 256, 256);

    const isCommercial = usage === 'Commercial';
    const isCivic = usage === 'Civic';
    
    // Window design details
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;

    const cols = 6;
    const rows = 3;
    const w = 28;
    const h = 55;
    const gapX = (256 - cols * w) / (cols + 1);
    const gapY = (256 - rows * h) / (rows + 1);

    for (let r = 0; r < rows; r++) {
        const isGround = (r === rows - 1);
        
        for (let c = 0; c < cols; c++) {
            const x = gapX + c * (w + gapX);
            const y = gapY + r * (h + gapY);

            if (isGround && (c === 2 || c === 3)) {
                // Entrance door
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(x, y, w, h + gapY);
                ctx.fillStyle = '#93c5fd';
                ctx.fillRect(x + 4, y + 4, w - 8, h / 2);
                
                // Emissive door
                emCtx.fillStyle = '#000000';
                emCtx.fillRect(x, y, w, h + gapY);
            } else {
                // Window glass
                ctx.fillStyle = isCommercial ? '#1e3a8a' : (isCivic ? '#115e59' : '#3f3f46');
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);

                // Window subdivisions
                ctx.beginPath();
                ctx.moveTo(x + w / 2, y);
                ctx.lineTo(x + w / 2, y + h);
                ctx.moveTo(x, y + h / 2);
                ctx.lineTo(x + w, y + h / 2);
                ctx.stroke();

                // Randomize window state: 45% chance of being lit
                const isLit = Math.random() < 0.45;
                if (isLit) {
                    ctx.fillStyle = isCommercial ? '#93c5fd' : '#fef08a';
                    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
                    
                    emCtx.fillStyle = isCommercial ? '#60a5fa' : '#fef08a';
                    emCtx.fillRect(x + 2, y + 2, w - 4, h - 4);
                }
            }
        }
    }

    const diffuseTex = new THREE.CanvasTexture(canvas);
    diffuseTex.wrapS = THREE.RepeatWrapping;
    diffuseTex.wrapT = THREE.RepeatWrapping;

    const emissiveTex = new THREE.CanvasTexture(emCanvas);
    emissiveTex.wrapS = THREE.RepeatWrapping;
    emissiveTex.wrapT = THREE.RepeatWrapping;

    return { map: diffuseTex, emissiveMap: emissiveTex };
}

// Slanted/Hipped pitched roof generator for Residential typologies
function buildPitchedRoof(parentMesh, footprintPoints, height) {
    // 1. Calculate top vertices of building
    const topVerts = footprintPoints.map(pt => new THREE.Vector3(pt.x, height, -pt.y));
    const N = topVerts.length;

    // 2. Calculate top centroid
    let cx = 0, cz = 0;
    topVerts.forEach(v => { cx += v.x; cz += v.z; });
    cx /= N;
    cz /= N;
    const topCentroid = new THREE.Vector3(cx, height + 4.0, cz); // Ridge elevated by 4.0m

    // 3. Build geometry faces using BufferGeometry
    const vertices = [];
    for (let i = 0; i < N; i++) {
        const v1 = topVerts[i];
        const v2 = topVerts[(i + 1) % N];

        // Push triangle: v1, v2, topCentroid
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(topCentroid.x, topCentroid.y, topCentroid.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: 0x991b1b, // red clay tiles
        roughness: 0.7,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentMesh.add(mesh);
}

// Flat roof details (helipad, HVAC boxes, beacon lights)
function addRooftopDetails(parentMesh, insetRing, height, usage) {
    let cx = 0, cy = 0;
    insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= insetRing.length;
    cy /= insetRing.length;

    // Penthouse/elevator shaft
    const pentGeom = new THREE.BoxGeometry(6, 3, 6);
    const pentMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
    const penthouse = new THREE.Mesh(pentGeom, pentMat);
    penthouse.position.set(cx, height + 1.5, -cy);
    penthouse.castShadow = true;
    parentMesh.add(penthouse);

    // Beacon warning light on penthouse top (blinking red warning beacon)
    const beaconGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true });
    const beacon = new THREE.Mesh(beaconGeom, beaconMat);
    beacon.position.set(0, 1.7, 0);
    beacon.userData = { isBeacon: true };
    penthouse.add(beacon);

    // Glowing pointlight
    const beaconLight = new THREE.PointLight(0xef4444, 2, 20);
    beacon.add(beaconLight);

    // HVAC boxes
    const hvacGeom = new THREE.BoxGeometry(2, 1.2, 2);
    const hvacMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    for (let i = 0; i < 2; i++) {
        const hvac = new THREE.Mesh(hvacGeom, hvacMat);
        hvac.position.set(cx - 6 + i * 12, height + 0.6, -cy + 6);
        hvac.castShadow = true;
        parentMesh.add(hvac);
    }

    // Commercial Helipad painting
    if (usage === 'Commercial') {
        const padGeom = new THREE.CylinderGeometry(5, 5, 0.1, 32);
        
        // Draw Helipad letter canvas texture
        const padCanvas = document.createElement('canvas');
        padCanvas.width = 128;
        padCanvas.height = 128;
        const padCtx = padCanvas.getContext('2d');
        padCtx.fillStyle = '#4b5563'; // concrete pad
        padCtx.fillRect(0, 0, 128, 128);
        
        // Draw white circle
        padCtx.strokeStyle = '#ffffff';
        padCtx.lineWidth = 6;
        padCtx.beginPath();
        padCtx.arc(64, 64, 40, 0, Math.PI * 2);
        padCtx.stroke();
        
        // Draw H letter
        padCtx.fillStyle = '#ffffff';
        padCtx.font = 'bold 50px Arial';
        padCtx.textAlign = 'center';
        padCtx.textBaseline = 'middle';
        padCtx.fillText('H', 64, 64);
        
        const padTex = new THREE.CanvasTexture(padCanvas);
        const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.7 });
        const pad = new THREE.Mesh(padGeom, padMat);
        pad.position.set(cx, height + 0.05, -cy - 5);
        pad.receiveShadow = true;
        parentMesh.add(pad);
    }

    // Solar panels for Civic/Institutional
    if (usage === 'Civic') {
        const panelGeom = new THREE.BoxGeometry(3, 0.1, 1.6);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.1 });
        for (let i = -1; i <= 1; i++) {
            const panel = new THREE.Mesh(panelGeom, panelMat);
            panel.rotation.x = -Math.PI / 6;
            panel.position.set(cx + i * 5, height + 0.5, -cy - 6);
            panel.castShadow = true;
            parentMesh.add(panel);
        }
    }
}

// 3D Semi-transparent Wireframe Zoning Envelope
function buildZoningEnvelope(item, insetRing, maxHeight, isViolated) {
    const envShape = new THREE.Shape();
    insetRing.forEach((pt, i) => {
        if (i === 0) envShape.moveTo(pt.x, pt.y);
        else envShape.lineTo(pt.x, pt.y);
    });

    const envGeom = new THREE.ExtrudeGeometry(envShape, { depth: maxHeight, bevelEnabled: false });
    envGeom.rotateX(-Math.PI / 2);
    envGeom.translate(0, maxHeight, 0);

    const envColor = isViolated ? 0xef4444 : 0x10b981;
    const envMat = new THREE.MeshStandardMaterial({
        color: envColor,
        transparent: true,
        opacity: isViolated ? 0.25 : 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    const envMesh = new THREE.Mesh(envGeom, envMat);
    scene.add(envMesh);
    item.zoningMesh = envMesh;

    const edges = new THREE.EdgesGeometry(envGeom);
    const lineMat = new THREE.LineBasicMaterial({
        color: envColor,
        linewidth: 1.5,
        transparent: true,
        opacity: isViolated ? 0.7 : 0.35
    });
    const line = new THREE.LineSegments(edges, lineMat);
    envMesh.add(line);
}

// Draw a red guideline if setback is too large to fit a building footprint
function drawSetbackErrorLine(item) {
    const borderPoints = item.outerRing.map(pt => new THREE.Vector3(pt.x, 0.15, -pt.y));
    borderPoints.push(borderPoints[0].clone());
    const errorGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const errorMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 });
    const errorLine = new THREE.Line(errorGeom, errorMat);
    scene.add(errorLine);
    item.setbackMesh = errorLine;
}

// Generate animated low-poly traffic cars driving around parcel block perimeters
function generateTrafficCars() {
    // Clear old traffic cars
    trafficCars.forEach(car => {
        scene.remove(car.carMesh);
    });
    trafficCars = [];

    // Find suitable loop tracks: sidewalk boundaries expanded by 3.5m are roads!
    parcelFeatures.forEach(item => {
        const roadRing = offsetPolygonRing(item.outerRing, -4.5);
        if (!roadRing) return;

        // Spawn 2 cars per parcel block
        const colors = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981];
        
        for (let i = 0; i < 2; i++) {
            const carGeom = new THREE.BoxGeometry(3.5, 1.4, 1.8);
            const carColor = colors[Math.floor(Math.random() * colors.length)];
            const carMat = new THREE.MeshStandardMaterial({ color: carColor, roughness: 0.5 });
            const carMesh = new THREE.Mesh(carGeom, carMat);
            carMesh.castShadow = true;

            // Simple cabin top
            const cabinGeom = new THREE.BoxGeometry(2, 0.8, 1.6);
            const cabinMat = new THREE.MeshStandardMaterial({ color: 0x18181b });
            const cabin = new THREE.Mesh(cabinGeom, cabinMat);
            cabin.position.set(-0.3, 1.0, 0);
            carMesh.add(cabin);

            // Front headlights (glowing spheres)
            const headlightGeom = new THREE.SphereGeometry(0.2, 8, 8);
            const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
            for (let s = -1; s <= 1; s += 2) {
                const headlight = new THREE.Mesh(headlightGeom, headlightMat);
                headlight.position.set(1.76, -0.2, s * 0.6);
                headlight.userData = { isHeadlight: true };
                headlight.visible = false; // off by default (daylight)
                carMesh.add(headlight);
            }

            // Rear brake taillights (red spheres)
            const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
            for (let s = -1; s <= 1; s += 2) {
                const taillight = new THREE.Mesh(headlightGeom, taillightMat);
                taillight.position.set(-1.76, -0.2, s * 0.6);
                taillight.userData = { isTaillight: true };
                taillight.visible = false;
                carMesh.add(taillight);
            }

            scene.add(carMesh);

            trafficCars.push({
                carMesh: carMesh,
                roadRing: roadRing,
                speed: 0.05 + Math.random() * 0.05,
                progress: Math.random() * roadRing.length
            });
        }
    });

    // Make sure headlights match current slider value immediately
    updateSolarPhysics(parseFloat(inTime.value));
}

// Drive cars along their respective road loop loops
function updateTraffic() {
    trafficCars.forEach(car => {
        const ring = car.roadRing;
        car.progress += car.speed;
        
        // Find segment indices based on progress
        const idx1 = Math.floor(car.progress) % ring.length;
        const idx2 = (idx1 + 1) % ring.length;
        const segmentProgress = car.progress % 1.0;

        const pt1 = ring[idx1];
        const pt2 = ring[idx2];

        // Interpolate position
        const x = pt1.x + (pt2.x - pt1.x) * segmentProgress;
        const z = - (pt1.y + (pt2.y - pt1.y) * segmentProgress);

        car.carMesh.position.set(x, 0.65, z); // lift off ground

        // Calculate heading rotation
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const heading = Math.atan2(-dy, dx);
        car.carMesh.rotation.y = heading;
    });
}

// Click listener to select building and open panel details
function onDocumentClick(event) {
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = [];
    parcelFeatures.forEach(item => {
        if (item.parcelMesh) meshes.push(item.parcelMesh);
        if (item.buildingMesh) meshes.push(item.buildingMesh);
    });

    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const hitObject = intersects[0].object;
        const item = hitObject.userData.parcelItem;
        selectParcel(item);
    } else {
        deselectParcel();
    }
}

// Handle parcel selection, loading values to sliders
function selectParcel(item) {
// Handle parcel selection, loading values to sliders
function selectParcel(item) {
    if (selectedParcel) {
        setBuildingHighlight(selectedParcel.buildingMesh, false);
    }

    selectedParcel = item;
    setBuildingHighlight(item.buildingMesh, true);

    // Populate sliders
    inSetback.value = item.params.setback;
    inFloors.value = item.params.floors;
    inFloorHeight.value = item.params.floorHeight;
    inTypology.value = item.params.typology;
    inUsage.value = item.params.usage;
    
    // Zoning sliders
    inMaxBcr.value = item.params.maxBcr;
    inMaxFar.value = item.params.maxFar;
    inMaxHeight.value = item.params.maxHeight;

    // Populate labels
    lblSetback.textContent = item.params.setback.toFixed(1);
    lblFloors.textContent = item.params.floors;
    lblFloorHeight.textContent = item.params.floorHeight.toFixed(1);
    lblMaxBcr.textContent = item.params.maxBcr.toFixed(2);
    lblMaxFar.textContent = item.params.maxFar.toFixed(1);
    lblMaxHeight.textContent = item.params.maxHeight.toFixed(1);

    metFid.textContent = item.fid;
    metArea.textContent = Math.round(item.area).toLocaleString() + " m²";

    placeholderEl.classList.add('hidden');
    controlsEl.classList.remove('hidden');

    updateDashboard(item);
}

// Deselect selected parcel and hide controls panel
function deselectParcel() {
    if (selectedParcel) {
        setBuildingHighlight(selectedParcel.buildingMesh, false);
    }
    selectedParcel = null;

    placeholderEl.classList.remove('hidden');
    controlsEl.classList.add('hidden');
}

// Helper to update opacity/emission highlights on building selection
function setBuildingHighlight(meshOrGroup, isSelected) {
    if (!meshOrGroup) return;
    const tVal = parseFloat(inTime.value);
    const isNight = tVal < 7.5 || tVal > 19.5;
    
    meshOrGroup.traverse(child => {
        if (child.isMesh && Array.isArray(child.material)) {
            const wallMat = child.material[1];
            if (wallMat) {
                wallMat.opacity = isSelected ? 1.0 : 0.85;
                if (isSelected) {
                    wallMat.emissive.setHex(0xaaaaaa); // selection highlight tint
                    wallMat.emissiveIntensity = 1.5;
                } else {
                    wallMat.emissive.setHex(0xffffff); // default emissiveMap color
                    wallMat.emissiveIntensity = isNight ? 1.0 : 0.0;
                }
            }
        }
    });
}

// Live calculation of regulatory compliance metrics (FAR, BCR, Height)
function updateDashboard(item) {
    const setback = item.params.setback;
    const floors = item.params.floors;
    const height = floors * item.params.floorHeight;
    
    // Calculate footprint area
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    let footprintArea = 0;
    let gfa = 0;
    
    if (item.params.usage === 'Park') {
        footprintArea = 0;
        gfa = 0;
    } else if (insetRing && insetRing.length >= 3) {
        if (item.params.typology === 'Courtyard') {
            const innerSetback = 8;
            const innerRing = offsetPolygonRing(insetRing, innerSetback);
            const outerArea = calculatePolygonArea(insetRing);
            const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
            footprintArea = Math.max(0, outerArea - innerArea);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'Slab') {
            const slabShape = buildSlabShape(insetRing, 12);
            footprintArea = calculateShapeArea(slabShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'LShape') {
            const lShape = buildLShape(insetRing, 12);
            footprintArea = calculateShapeArea(lShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'UShape') {
            const uShape = buildUShape(insetRing, 12);
            footprintArea = calculateShapeArea(uShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'PodiumTower') {
            const podiumArea = calculatePolygonArea(insetRing);
            const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
            const towerArea = calculatePolygonArea(towerRing);
            const podiumH = Math.min(height, 2 * item.params.floorHeight);
            const towerH = Math.max(0, height - podiumH);
            const podiumFloors = Math.round(podiumH / item.params.floorHeight);
            const towerFloors = Math.round(towerH / item.params.floorHeight);
            footprintArea = podiumArea;
            gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);
        } else { // Tower
            footprintArea = calculatePolygonArea(insetRing);
            gfa = footprintArea * floors;
        }
    }

    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Update UI elements
    metFootprint.textContent = Math.round(footprintArea).toLocaleString() + " m²";
    metGfa.textContent = Math.round(gfa).toLocaleString() + " m²";
    metHeight.textContent = item.params.usage === 'Park' ? "0.0 m" : height.toFixed(1) + " m";
    
    // Actual vs Limit Text Labels
    metBcrLabel.textContent = `${bcr.toFixed(2)} / ${item.params.maxBcr.toFixed(2)}`;
    metFarLabel.textContent = `${far.toFixed(2)} / ${item.params.maxFar.toFixed(2)}`;

    // Update Visual Gauge Bars widths
    const bcrPercent = Math.min(100, (bcr / item.params.maxBcr) * 100);
    const farPercent = Math.min(100, (far / item.params.maxFar) * 100);

    bcrFillEl.style.width = `${bcrPercent}%`;
    farFillEl.style.width = `${farPercent}%`;

    // Colors of progress bars based on violations
    const bcrViolated = bcr > item.params.maxBcr;
    bcrFillEl.className = `gauge-bar-fill ${bcrViolated ? "red-bar" : "green-bar"}`;
    metBcrLabel.style.color = bcrViolated ? "#ef4444" : "#10b981";

    const farViolated = far > item.params.maxFar;
    farFillEl.className = `gauge-bar-fill ${farViolated ? "red-bar" : "green-bar"}`;
    metFarLabel.style.color = farViolated ? "#ef4444" : "#10b981";

    const heightViolated = height > item.params.maxHeight;
    metHeight.style.color = heightViolated ? "#ef4444" : "#10b981";

    const violated = heightViolated || bcrViolated || farViolated || footprintArea === 0;
    
    metStatus.textContent = violated ? "VIOLATION" : "COMPLIANT";
    metStatus.className = "stat-val status-badge " + (violated ? "violation" : "compliant");
}

// Capture current 3D WebGL viewport canvas as a PNG screenshot download
function captureViewport() {
    try {
        // Redraw scene
        renderer.render(scene, camera);
        const dataURL = renderer.domElement.toDataURL('image/png');
        
        const link = document.createElement('a');
        link.download = 'planx_urban_design_capture.png';
        link.href = dataURL;
        link.click();
    } catch (e) {
        console.error(e);
        alert("Failed to capture viewport screenshot.");
    }
}

// POST modifications back to the local Python QGIS server
async function syncToQGIS() {
    if (!selectedParcel) return;

    btnSync.disabled = true;
    btnSync.textContent = "Syncing...";

    const setback = selectedParcel.params.setback;
    const insetRing = offsetPolygonRing(selectedParcel.outerRing, setback);
    
    let geoCoords = [];
    if (insetRing) {
        geoCoords = insetRing.map(pt => {
            return [pt.x + centerX, pt.y + centerY];
        });
    }

    const payload = {
        updates: [
            {
                id: selectedParcel.fid,
                far: parseFloat(metFarLabel.textContent.split(" / ")[0]),
                bcr: parseFloat(metBcrLabel.textContent.split(" / ")[0]),
                gfa: parseFloat(metGfa.textContent.replace(/\D/g, '')),
                setback: selectedParcel.params.setback,
                floors: selectedParcel.params.floors,
                floor_h: selectedParcel.params.floorHeight,
                typology: selectedParcel.params.typology,
                usage: selectedParcel.params.usage,
                max_bcr: selectedParcel.params.maxBcr,
                max_far: selectedParcel.params.maxFar,
                max_height: selectedParcel.params.maxHeight,
                coordinates: geoCoords
            }
        ]
    };

    try {
        const response = await fetch('/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const res = await response.json();
        if (res.status === 'ok') {
            alert("Successfully synced modifications back to QGIS!");
        } else {
            alert("Synchronization failed:\n" + res.message);
        }
    } catch (e) {
        console.error(e);
        alert("Connection error: Could not reach QGIS plugin server.");
    } finally {
        btnSync.disabled = false;
        btnSync.textContent = "Sync Parameters to QGIS";
    }
}

// ───────────────────────── Mathematical Geometry Helpers ─────────────────────────

// Standard Polygon Area calculation (Shoelace formula)
function calculatePolygonArea(ring) {
    let area = 0;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area / 2);
}

// Calculate area of a THREE.Shape
function calculateShapeArea(shape) {
    const pts = shape.getPoints();
    return calculatePolygonArea(pts.map(pt => { return {x: pt.x, y: pt.y}; }));
}

// Perform polygon segment corner-bisector offsetting/insetting
function offsetPolygonRing(ring, distance) {
    if (Math.abs(distance) <= 0.05) return ring.map(pt => { return {x: pt.x, y: pt.y}; });

    const N = ring.length;
    const offsetSegments = [];

    // Calculate inward shifted segments
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.001) continue;

        // Inward pointing normal
        const nx = -dy / len;
        const ny = dx / len;

        offsetSegments.push({
            p1: { x: p1.x + nx * distance, y: p1.y + ny * distance },
            p2: { x: p2.x + nx * distance, y: p2.y + ny * distance },
            dir: { x: dx / len, y: dy / len }
        });
    }

    if (offsetSegments.length < 3) return null;

    // Intersect adjacent shifted segments to find new vertices
    const insetRing = [];
    const M = offsetSegments.length;
    for (let i = 0; i < M; i++) {
        const s1 = offsetSegments[(i - 1 + M) % M];
        const s2 = offsetSegments[i];

        const pt = intersectLines(s1.p1, s1.dir, s2.p1, s2.dir);
        if (pt) {
            const d1 = distToSegment(pt, ring[(i - 1 + M) % M], ring[i]);
            const checkDist = Math.abs(distance);
            if (d1 > checkDist * 4) return null; // self-intersection/degenerate
            insetRing.push(pt);
        } else {
            insetRing.push({ x: s2.p1.x, y: s2.p1.y });
        }
    }

    return insetRing;
}

// Find intersection point of two infinite 2D lines
function intersectLines(p1, d1, p2, d2) {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 0.0001) return null;

    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    return {
        x: p1.x + d1.x * t,
        y: p1.y + d1.y * t
    };
}

// Distance from point to line segment
function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return Math.sqrt((p.x - a.x)**2 + (p.y - a.y)**2);
    
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.sqrt((p.x - projX)**2 + (p.y - projY)**2);
}

// Generate a rectangular Slab/Row building footprint along the longest side
function buildSlabShape(ring, width) {
    let maxLen = -1;
    let bestStart = null, bestEnd = null;
    const N = ring.length;
    
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > maxLen) {
            maxLen = len;
            bestStart = p1;
            bestEnd = p2;
        }
    }

    let cx = 0, cy = 0;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= N;
    cy /= N;

    const dx = bestEnd.x - bestStart.x;
    const dy = bestEnd.y - bestStart.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy;
    const ny = ux;

    const slabLength = maxLen * 0.9;
    const shape = new THREE.Shape();
    
    const wHalf = width / 2;
    const lHalf = slabLength / 2;

    const c1x = cx - ux * lHalf - nx * wHalf;
    const c1y = cy - uy * lHalf - ny * wHalf;

    const c2x = cx + ux * lHalf - nx * wHalf;
    const c2y = cy + uy * lHalf - ny * wHalf;

    const c3x = cx + ux * lHalf + nx * wHalf;
    const c3y = cy + uy * lHalf + ny * wHalf;

    const c4x = cx - ux * lHalf + nx * wHalf;
    const c4y = cy - uy * lHalf + ny * wHalf;

    shape.moveTo(c1x, c1y);
    shape.lineTo(c2x, c2y);
    shape.lineTo(c3x, c3y);
    shape.lineTo(c4x, c4y);

    return shape;
}

// Start the application
init();
