/* app.js - PlanX Urban Procedural 3D */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Application State
let scene, camera, renderer, controls;
let raycaster, mouse;
let parcelFeatures = []; // Array of { fid, properties, outerRing, parcelMesh, buildingMesh, setbackMesh, area, params }
let selectedParcel = null;

// Projection variables (local offset)
let centerX = 0;
let centerY = 0;
let totalArea = 0;

// Setup UI Element references
const loadingEl = document.getElementById('loading');
const placeholderEl = document.getElementById('selection-placeholder');
const controlsEl = document.getElementById('editor-controls');
const btnSync = document.getElementById('btn-sync');

// Input controls
const inTypology = document.getElementById('input-typology');
const inUsage = document.getElementById('input-usage');
const inSetback = document.getElementById('input-setback');
const inFloors = document.getElementById('input-floors');
const inFloorHeight = document.getElementById('input-floorheight');

// Label values
const lblSetback = document.getElementById('val-setback');
const lblFloors = document.getElementById('val-floors');
const lblFloorHeight = document.getElementById('val-floorheight');

// Metrics
const metFid = document.getElementById('prop-fid');
const metArea = document.getElementById('prop-area');
const metFootprint = document.getElementById('metric-footprint');
const metGfa = document.getElementById('metric-gfa');
const metBcr = document.getElementById('metric-bcr');
const metFar = document.getElementById('metric-far');
const metStatus = document.getElementById('metric-status');

// HUD
const hudTotalParcels = document.getElementById('hud-total-parcels');
const hudCrs = document.getElementById('hud-crs');

// Initialize the 3D scene
function init() {
    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // Slate-900

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 150, 250);

    // 3. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('viewport').appendChild(renderer.domElement);

    // 4. OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(150, 400, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 1000;
    
    // Wide shadow orthographic camera bounds
    const d = 500;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Helper Grid
    const grid = new THREE.GridHelper(1000, 100, 0x334155, 0x1e293b);
    grid.position.y = -0.05;
    scene.add(grid);

    // 6. Interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    window.addEventListener('click', onDocumentClick);
    window.addEventListener('resize', onWindowResize);

    // Bind slider values
    setupInputListeners();

    // 7. Load Data
    loadGeoJSON();

    animate();
}

// Render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
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

        // Update labels
        lblSetback.textContent = selectedParcel.params.setback.toFixed(1);
        lblFloors.textContent = selectedParcel.params.floors;
        lblFloorHeight.textContent = selectedParcel.params.floorHeight.toFixed(1);

        // Rebuild meshes
        rebuildParcel3D(selectedParcel);
        updateDashboard(selectedParcel);
    };

    inSetback.addEventListener('input', triggerUpdate);
    inFloors.addEventListener('input', triggerUpdate);
    inFloorHeight.addEventListener('input', triggerUpdate);
    inTypology.addEventListener('change', triggerUpdate);
    inUsage.addEventListener('change', triggerUpdate);

    btnSync.addEventListener('click', syncToQGIS);
}

// Fetch exported layer GeoJSON from local Python server
async function loadGeoJSON() {
    try {
        const response = await fetch('/data.geojson');
        if (!response.ok) throw new Error("Veri yuklenemedi");
        
        const data = await response.json();
        parseGeoJSON(data);
        
        // Hide loading
        loadingEl.style.opacity = 0;
        setTimeout(() => loadingEl.classList.add('hidden'), 500);
    } catch (e) {
        console.error(e);
        document.getElementById('loading-text').innerText = "HATA: Veri yüklenemedi. QGIS bağlantısını kontrol edin.";
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

        // Parse outer polygon ring
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
            usage: props.usage !== undefined ? props.usage : 'Residential'
        };

        const item = {
            fid,
            properties: props,
            outerRing: localPoints,
            area,
            params,
            parcelMesh: null,
            buildingMesh: null,
            setbackMesh: null
        };

        // Render parcel ground and default building
        buildParcelGround(item);
        rebuildParcel3D(item);
        
        parcelFeatures.push(item);
    });

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
    geom.rotateX(-Math.PI / 2); // Flip flat on ground

    // Ground material
    const mat = new THREE.MeshStandardMaterial({
        color: 0x334155, // slate-700
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
    // close loop
    borderPoints.push(borderPoints[0].clone());
    
    const lineGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x64748b, linewidth: 2 });
    const line = new THREE.Line(lineGeom, lineMat);
    scene.add(line);
}

// Rebuild building massing and setback lines based on params
function rebuildParcel3D(item) {
    // 1. Clear old models
    if (item.buildingMesh) {
        scene.remove(item.buildingMesh);
        item.buildingMesh.geometry.dispose();
        item.buildingMesh = null;
    }
    if (item.setbackMesh) {
        scene.remove(item.setbackMesh);
        item.setbackMesh.geometry.dispose();
        item.setbackMesh = null;
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
        // Setback too large, cannot build!
        drawSetbackErrorLine(item);
        return;
    }

    // Draw setback guideline
    const setbackPoints = insetRing.map(pt => new THREE.Vector3(pt.x, 0.1, -pt.y));
    setbackPoints.push(setbackPoints[0].clone());
    const sbGeom = new THREE.BufferGeometry().setFromPoints(setbackPoints);
    const sbMat = new THREE.LineDashedMaterial({ color: 0x0f766e, dashSize: 2, gapSize: 1.5 });
    const sbLine = new THREE.Line(sbGeom, sbMat);
    sbLine.computeLineDistances();
    scene.add(sbLine);
    item.setbackMesh = sbLine;

    // 3. Build Building Massing
    const bldShape = new THREE.Shape();
    insetRing.forEach((pt, i) => {
        if (i === 0) bldShape.moveTo(pt.x, pt.y);
        else bldShape.lineTo(pt.x, pt.y);
    });

    let bldGeom;
    if (typology === 'Courtyard') {
        // Create an inner courtyard ring
        const innerSetback = 8; // 8m building depth
        const innerRing = offsetPolygonRing(insetRing, innerSetback);
        if (innerRing && innerRing.length >= 3) {
            const hole = new THREE.Path();
            innerRing.forEach((pt, i) => {
                if (i === 0) hole.moveTo(pt.x, pt.y);
                else hole.lineTo(pt.x, pt.y);
            });
            bldShape.holes.push(hole);
        }
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
    } else if (typology === 'Slab') {
        // Draw a long block along longest axis
        const slabShape = buildSlabShape(insetRing, 12); // 12m slab depth
        bldGeom = new THREE.ExtrudeGeometry(slabShape, { depth: height, bevelEnabled: false });
    } else { // Tower
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
    }

    bldGeom.rotateX(-Math.PI / 2); // Lay flat
    bldGeom.translate(0, height, 0); // lift up so pivot is at base

    // Map function to color
    let color = 0xf59e0b; // Yellow (Residential)
    if (usage === 'Commercial') color = 0xef4444; // Red
    else if (usage === 'Civic') color = 0x3b82f6; // Blue

    const mat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: selectedParcel === item ? 0.95 : 0.85
    });

    const bldMesh = new THREE.Mesh(bldGeom, mat);
    bldMesh.castShadow = true;
    bldMesh.receiveShadow = true;
    bldMesh.userData = { parcelItem: item };
    scene.add(bldMesh);
    item.buildingMesh = bldMesh;
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

// Click listener to select building and open panel details
function onDocumentClick(event) {
    // Avoid clicks on UI container
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) return;

    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Collect meshes
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
    // Restore previous selected building color opacity
    if (selectedParcel && selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material.opacity = 0.85;
        selectedParcel.buildingMesh.material.emissive.setHex(0x000000);
    }

    selectedParcel = item;
    
    // Highlight new selected
    if (selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material.opacity = 1.0;
        selectedParcel.buildingMesh.material.emissive.setHex(0x111e0e); // slight glowing green outline/tint
    }

    // Populate sliders
    inSetback.value = item.params.setback;
    inFloors.value = item.params.floors;
    inFloorHeight.value = item.params.floorHeight;
    inTypology.value = item.params.typology;
    inUsage.value = item.params.usage;

    // Populate labels
    lblSetback.textContent = item.params.setback.toFixed(1);
    lblFloors.textContent = item.params.floors;
    lblFloorHeight.textContent = item.params.floorHeight.toFixed(1);

    metFid.textContent = item.fid;
    metArea.textContent = Math.round(item.area).toLocaleString() + " m²";

    // Show controls
    placeholderEl.classList.add('hidden');
    controlsEl.classList.remove('hidden');

    updateDashboard(item);
}

// Deselect selected parcel and hide controls panel
function deselectParcel() {
    if (selectedParcel && selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material.opacity = 0.85;
        selectedParcel.buildingMesh.material.emissive.setHex(0x000000);
    }
    selectedParcel = null;

    placeholderEl.classList.remove('hidden');
    controlsEl.classList.add('hidden');
}

// Live calculation of imar dashboard metrics (FAR, BCR, GFA)
function updateDashboard(item) {
    const setback = item.params.setback;
    const floors = item.params.floors;
    
    // 1. Calculate footprint area
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    let footprintArea = 0;
    
    if (insetRing && insetRing.length >= 3) {
        if (item.params.typology === 'Courtyard') {
            const innerSetback = 8;
            const innerRing = offsetPolygonRing(insetRing, innerSetback);
            const outerArea = calculatePolygonArea(insetRing);
            const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
            footprintArea = Math.max(0, outerArea - innerArea);
        } else if (item.params.typology === 'Slab') {
            const slabShape = buildSlabShape(insetRing, 12);
            footprintArea = calculateShapeArea(slabShape);
        } else { // Tower
            footprintArea = calculatePolygonArea(insetRing);
        }
    }

    const gfa = footprintArea * floors;
    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Update UI elements
    metFootprint.textContent = Math.round(footprintArea).toLocaleString() + " m²";
    metGfa.textContent = Math.round(gfa).toLocaleString() + " m²";
    metBcr.textContent = bcr.toFixed(2);
    metFar.textContent = far.toFixed(2);

    // Violation Check
    // If FAR > 2.5 or BCR > 0.45 or building footprint is zero, violate
    const violated = far > 2.5 || bcr > 0.45 || footprintArea === 0;
    
    metStatus.textContent = violated ? "LİMİT AŞIMI" : "UYUMLU";
    metStatus.className = "stat-val status-badge " + (violated ? "violation" : "compliant");
}

// POST modifications back to the local Python QGIS server
async function syncToQGIS() {
    if (!selectedParcel) return;

    btnSync.disabled = true;
    btnSync.textContent = "Gönderiliyor...";

    // Translate local coordinates back to georeferenced coordinates
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
                far: parseFloat(metFar.textContent),
                bcr: parseFloat(metBcr.textContent),
                gfa: parseFloat(metGfa.textContent.replace(/\D/g, '')),
                setback: selectedParcel.params.setback,
                floors: selectedParcel.params.floors,
                floor_h: selectedParcel.params.floorHeight,
                typology: selectedParcel.params.typology,
                usage: selectedParcel.params.usage,
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
            alert("QGIS başarıyla senkronize edildi!");
        } else {
            alert("Senkronizasyon hatası:\n" + res.message);
        }
    } catch (e) {
        console.error(e);
        alert("Bağlantı hatası: QGIS eklenti sunucusuna erişilemedi.");
    } finally {
        btnSync.disabled = false;
        btnSync.textContent = "QGIS ile Senkronize Et";
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
    if (distance <= 0.05) return ring.map(pt => { return {x: pt.x, y: pt.y}; });

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

        // Inward pointing normal (assuming counter-clockwise CCW winding)
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
            // Safety check: ensure the point didn't fly off to infinity
            const d1 = distToSegment(pt, ring[(i - 1 + M) % M], ring[i]);
            if (d1 > distance * 4) return null; // self-intersection/degenerate
            insetRing.push(pt);
        } else {
            insetRing.push({ x: s2.p1.x, y: s2.p1.y });
        }
    }

    return insetRing;
}

// Find intersection point of two infinite 2D lines (Point + Direction vector)
function intersectLines(p1, d1, p2, d2) {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 0.0001) return null; // parallel

    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    return {
        x: p1.x + d1.x * t,
        y: p1.y + d1.y * t
    };
}

// Distance from point to line segment (for self-intersection guards)
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
    // Find the longest segment of the inset ring
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

    // Centroid of the polygon
    let cx = 0, cy = 0;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= N;
    cy /= N;

    // Direction along the longest segment
    const dx = bestEnd.x - bestStart.x;
    const dy = bestEnd.y - bestStart.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;

    // Normal vector
    const nx = -uy;
    const ny = ux;

    // Create Slab shape centered on the polygon centroid
    const slabLength = maxLen * 0.9;
    const shape = new THREE.Shape();
    
    const wHalf = width / 2;
    const lHalf = slabLength / 2;

    // Calculate 4 corners
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
