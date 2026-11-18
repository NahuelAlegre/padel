"""Materiales toon para EEVEE, contorno de tinta por casco invertido y armado de la escena."""
import math

import bpy
from mathutils import Vector

# Dirección HACIA el sol y hacia la luz principal de los personajes, en ejes de Blender del
# personaje (mira a -Y). Se ajustan por vista en render_sprites.py.
INK = '#2a1b2e'
SHADOW_TINT = (0.60, 0.52, 0.74)    # la sombra vira al violeta, nunca al gris
LIGHT_GAIN = (1.10, 1.05, 0.96)
RIM_COLOR = (1.00, 0.80, 0.52)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h, linear=True):
    h = h.lstrip('#')
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [srgb_to_linear(c) for c in rgb] if linear else rgb


def lin(rgb):
    return [srgb_to_linear(c) for c in rgb]


def _mix(nt, a, b, fac, blend='MIX', loc=(0, 0)):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    n.location = loc
    for sock, val in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if hasattr(val, 'links') or hasattr(val, 'is_linked'):
            nt.links.new(val, sock)
        else:
            sock.default_value = val if not isinstance(val, (list, tuple)) or len(val) == 4 else (*val, 1.0)
    return n.outputs[2]


def toon_material(name, color_hex, sun_dir, flat=False, shadow_tint=SHADOW_TINT, rim=0.9, t_mid=0.22, t_light=0.80):
    """Tres tonos (sombra, base, luz) a partir de la luz real de la escena, más un filo cálido del sol.

    flat=True deja el color sin sombrear (blanco del ojo, brillo): solo recibe la sombra.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    base = hex_rgb(color_hex)
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    diff.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    lum = nt.nodes.new('ShaderNodeRGBToBW')
    nt.links.new(s2r.outputs[0], lum.inputs[0])

    def step(th):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'GREATER_THAN'
        nt.links.new(lum.outputs[0], m.inputs[0])
        m.inputs[1].default_value = th
        return m.outputs[0]
    mid, light = step(t_mid), step(t_light)
    shadow_col = [base[i] * srgb_to_linear(shadow_tint[i]) / srgb_to_linear(0.80) * 0.62 for i in range(3)]
    # la sombra se calcula en sRGB para que el tinte se vea igual que en el shader del navegador
    b_srgb = hex_rgb(color_hex, linear=False)
    shadow_col = lin([b_srgb[i] * shadow_tint[i] for i in range(3)])
    light_col = lin([min(1.0, b_srgb[i] * LIGHT_GAIN[i] + 0.03) for i in range(3)])
    if flat:
        shadow_col = lin([b_srgb[i] * (0.5 + 0.5 * shadow_tint[i]) for i in range(3)])
        light_col = base
    c = _mix(nt, (*shadow_col, 1), (*base, 1), mid)
    c = _mix(nt, c, (*light_col, 1), light)
    if rim > 0 and not flat:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        nt.links.new(geo.outputs['Normal'], dot.inputs[0])
        dot.inputs[1].default_value = Vector(sun_dir).normalized()
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.5
        a = nt.nodes.new('ShaderNodeMath')
        a.operation = 'GREATER_THAN'
        nt.links.new(lw.outputs['Facing'], a.inputs[0])
        a.inputs[1].default_value = 0.56
        b = nt.nodes.new('ShaderNodeMath')
        b.operation = 'GREATER_THAN'
        nt.links.new(dot.outputs['Value'], b.inputs[0])
        b.inputs[1].default_value = 0.18
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        nt.links.new(a.outputs[0], m.inputs[0])
        nt.links.new(b.outputs[0], m.inputs[1])
        m2 = nt.nodes.new('ShaderNodeMath')
        m2.operation = 'MULTIPLY'
        nt.links.new(m.outputs[0], m2.inputs[0])
        m2.inputs[1].default_value = rim
        rim_col = lin([min(1.0, b_srgb[i] * 0.45 + RIM_COLOR[i] * 0.62) for i in range(3)])
        c = _mix(nt, c, (*rim_col, 1), m2.outputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(c, em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


def ink_material(name='ink_outline', color_hex=INK):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*hex_rgb(color_hex), 1)
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    mat.use_backface_culling = True
    for attr in ('use_backface_culling_shadow',):
        if hasattr(mat, attr):
            setattr(mat, attr, True)
    return mat


FLAT = {'eye_white', 'ink', 'brow', 'mouth', 'racket_hole'}


def make_materials(palette, prefix, sun_dir):
    mats = {}
    for key, col in palette.items():
        mats[key] = toon_material(prefix + key, col, sun_dir, flat=key in FLAT)
        mats[key].use_backface_culling = True
    return mats


def add_outline(obj, thickness):
    """Casco invertido: copia agrandada con las normales al revés; solo se ve por atrás."""
    ink = ink_material(obj.name + '_ink')
    obj.data.materials.append(ink)
    mod = obj.modifiers.new('outline', 'SOLIDIFY')
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.vertex_group = '_outline'
    mod.thickness_vertex_group = 0.0
    mod.material_offset = 100
    mod.material_offset_rim = 100
    mod.use_quality_normals = True
    return mod


def setup_scene(res=(1024, 1024), samples=32, transparent=True):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    try:
        sc.eevee.taa_render_samples = samples
    except Exception:
        pass
    sc.render.filter_size = 1.2
    world = sc.world or bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg:
        bg.inputs[0].default_value = (0, 0, 0, 1)
        bg.inputs[1].default_value = 0.0
    return sc


def add_key_light(direction_to_light, strength=3.1416, angle_deg=1.5):
    """Sol de Blender que apunta desde `direction_to_light` hacia el origen."""
    data = bpy.data.lights.new('key', 'SUN')
    data.energy = strength
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new('key', data)
    bpy.context.scene.collection.objects.link(obj)
    d = Vector(direction_to_light).normalized()
    obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return obj


def add_camera(location, look_at, ortho_scale=None, lens=50.0):
    data = bpy.data.cameras.new('cam')
    obj = bpy.data.objects.new('cam', data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = Vector(location)
    d = Vector(look_at) - Vector(location)
    obj.rotation_euler = (-d).to_track_quat('Z', 'Y').to_euler()
    if ortho_scale:
        data.type = 'ORTHO'
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    data.clip_start, data.clip_end = 0.05, 500
    bpy.context.scene.camera = obj
    return obj


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
