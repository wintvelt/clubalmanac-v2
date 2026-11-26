// WP42b A15, A19: het verkleinde filmpje nakijken voordat het de deur uitgaat.
// Dezelfde regels als de mp4-controle van de backend (convex/lib/mp4.ts), maar
// strenger waar het om metadata gaat: een fout hier is altijd een fout in het
// verkleinen, nooit van het lid (A-antwoord 7).
// - Bovenaan: eerst `ftyp` (minstens 16 bytes, met een hoofdmerk dat de backend
//   aanneemt: `MP4_BRANDS`), vóór de index alleen `free`/`skip`/`wide`, de index
//   (`moov`) vóór de beelddata, en daarna alleen `mdat`/`free`/`skip`. Een kop
//   van 64 bits (grootte 1) wordt overal gelezen zoals een van 32 bits.
// - In de index geen enkel metadata-blok (`udta`, `meta`, `uuid`) en niet
//   gefragmenteerd (`mvex`).
// - Precies één beeldspoor in H.264 en hooguit één geluidsspoor in AAC, niets
//   anders.
// - De duur is de langste die het bestand noemt, zoals de backend hem meet:
//   `mvhd`, en per spoor `tkhd`, de som van `elst`, `mdhd` en de som van `stts`.

package expo.modules.clubalmanacvideo

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToLong

internal object Mp4Check {
  data class Info(val durationMs: Long)

  class Problem(message: String) : Exception(message)

  /** De merken die de backend aanneemt (`MP4_BRANDS` in convex/lib/mp4.ts). */
  private val MP4_BRANDS = setOf("isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ")
  private val BEFORE_INDEX = setOf("free", "skip", "wide")
  private val AFTER_INDEX = setOf("mdat", "free", "skip")
  private val FORBIDDEN = setOf("udta", "meta", "uuid", "mvex", "moof", "traf")
  private val TRACK_CONTAINERS = setOf("mdia", "minf", "stbl", "edts", "dinf")

  /** Hooguit zo groot mag de index zijn om hem in het geheugen te lezen. */
  private const val MAX_INDEX_BYTES = 32L * 1024 * 1024

  private class Box(val type: String, val start: Int, val payload: Int, val end: Int)

  fun check(file: File): Info {
    RandomAccessFile(file, "r").use { raf ->
      val size = raf.length()
      var offset = 0L
      var count = 0
      var index: ByteArray? = null
      var indexHeader = 8
      val head = ByteArray(16)
      while (offset < size) {
        if (++count > 64) throw Problem("te veel blokken")
        if (size - offset < 8) throw Problem("afgebroken blok")
        raf.seek(offset)
        val n = minOf(16L, size - offset).toInt()
        raf.readFully(head, 0, n)
        val buf = ByteBuffer.wrap(head)
        var boxSize = buf.getInt(0).toLong() and 0xffffffffL
        val type = String(head, 4, 4, Charsets.ISO_8859_1)
        var header = 8
        if (boxSize == 1L) {
          if (n < 16) throw Problem("afgebroken blok")
          boxSize = buf.getLong(8)
          header = 16
        } else if (boxSize == 0L) {
          boxSize = size - offset
        }
        if (boxSize < header || offset + boxSize > size) throw Problem("blok $type past niet")
        when {
          count == 1 -> {
            if (type != "ftyp") throw Problem("geen ftyp")
            if (boxSize < 16 || boxSize < header + 4) throw Problem("ftyp te kort")
            val brand = ByteArray(4)
            raf.seek(offset + header)
            raf.readFully(brand)
            val name = String(brand, Charsets.ISO_8859_1)
            if (name !in MP4_BRANDS) throw Problem("merk $name")
          }
          index == null && type == "moov" -> {
            if (boxSize > MAX_INDEX_BYTES) throw Problem("index te groot")
            val bytes = ByteArray(boxSize.toInt())
            raf.seek(offset)
            raf.readFully(bytes)
            index = bytes
            indexHeader = header
          }
          index == null && type == "mdat" -> throw Problem("index achteraan")
          index == null && type !in BEFORE_INDEX -> throw Problem("$type vóór de index")
          index != null && type !in AFTER_INDEX -> throw Problem("$type na de index")
        }
        offset += boxSize
      }
      return inspectIndex(index ?: throw Problem("geen index"), indexHeader)
    }
  }

  private fun u32(b: ByteArray, at: Int): Long = ByteBuffer.wrap(b, at, 4).int.toLong() and 0xffffffffL

  private fun u64(b: ByteArray, at: Int): Long {
    val v = ByteBuffer.wrap(b, at, 8).long
    if (v < 0) throw Problem("duur te groot")
    return v
  }

  private fun need(b: ByteArray, box: Box, bytes: Int) {
    if (box.payload + bytes > box.end || box.end > b.size) throw Problem("${box.type} te kort")
  }

  /** De kinderen van een blok; ze moeten het precies vullen. */
  private fun children(b: ByteArray, parent: Box): List<Box> {
    val out = ArrayList<Box>()
    var offset = parent.payload
    while (offset < parent.end) {
      if (parent.end - offset < 8) throw Problem("rest in ${parent.type}")
      var size = u32(b, offset)
      var header = 8
      if (size == 1L) {
        if (parent.end - offset < 16) throw Problem("rest in ${parent.type}")
        size = u64(b, offset + 8)
        header = 16
      } else if (size == 0L) {
        size = (parent.end - offset).toLong()
      }
      if (size < header || offset + size > parent.end) throw Problem("blok in ${parent.type} past niet")
      val type = String(b, offset + 4, 4, Charsets.ISO_8859_1)
      if (type in FORBIDDEN) throw Problem("$type in de index")
      out.add(Box(type, offset, offset + header, (offset + size).toInt()))
      offset += size.toInt()
    }
    return out
  }

  private fun ms(duration: Long, timescale: Long): Long =
    if (timescale > 0) (duration * 1000.0 / timescale).roundToLong() else 0

  private class Track(var handler: String? = null, var codec: String? = null)

  private fun inspectIndex(b: ByteArray, header: Int): Info {
    val moov = Box("moov", 0, header, b.size)
    val kids = children(b, moov)
    val mvhds = kids.filter { it.type == "mvhd" }
    if (mvhds.size != 1) throw Problem("geen mvhd")
    val mvhd = mvhds[0]
    val v1 = b[mvhd.payload].toInt() == 1
    need(b, mvhd, if (v1) 32 else 20)
    val timescale = u32(b, mvhd.payload + if (v1) 20 else 12)
    val movieDuration = if (v1) u64(b, mvhd.payload + 24) else u32(b, mvhd.payload + 16)
    if (movieDuration == 0L) throw Problem("duur 0")
    var maxMs = ms(movieDuration, timescale)

    val tracks = ArrayList<Track>()
    for (trak in kids.filter { it.type == "trak" }) {
      val track = Track()
      var mediaTimescale = 0L
      var sttsTotal = 0L
      fun visit(box: Box) {
        when (box.type) {
          "tkhd" -> {
            val tv1 = b[box.payload].toInt() == 1
            need(b, box, if (tv1) 36 else 24)
            val d = if (tv1) u64(b, box.payload + 28) else u32(b, box.payload + 20)
            maxMs = max(maxMs, ms(d, timescale))
          }
          "elst" -> {
            val ev1 = b[box.payload].toInt() == 1
            need(b, box, 8)
            val count = u32(b, box.payload + 4)
            val entry = if (ev1) 20 else 12
            if (box.payload + 8 + count * entry > box.end) throw Problem("elst te kort")
            var total = 0L
            for (k in 0 until count.toInt()) {
              val at = box.payload + 8 + k * entry
              total += if (ev1) u64(b, at) else u32(b, at)
            }
            maxMs = max(maxMs, ms(total, timescale))
          }
          "mdhd" -> {
            val mv1 = b[box.payload].toInt() == 1
            need(b, box, if (mv1) 32 else 20)
            mediaTimescale = u32(b, box.payload + if (mv1) 20 else 12)
            val d = if (mv1) u64(b, box.payload + 24) else u32(b, box.payload + 16)
            maxMs = max(maxMs, ms(d, mediaTimescale))
          }
          "hdlr" -> {
            need(b, box, 12)
            // In `minf` is het de data-handler, geen soort spoor.
            if (track.handler == null) track.handler = String(b, box.payload + 8, 4, Charsets.ISO_8859_1)
          }
          "stsd" -> {
            need(b, box, 16)
            track.codec = String(b, box.payload + 12, 4, Charsets.ISO_8859_1)
          }
          "stts" -> {
            need(b, box, 8)
            val count = u32(b, box.payload + 4)
            if (box.payload + 8 + count * 8 > box.end) throw Problem("stts te kort")
            for (k in 0 until count.toInt()) {
              val at = box.payload + 8 + k * 8
              sttsTotal += u32(b, at) * u32(b, at + 4)
            }
          }
          in TRACK_CONTAINERS -> for (child in children(b, box)) visit(child)
        }
      }
      for (child in children(b, trak)) visit(child)
      if (sttsTotal > 0) {
        if (mediaTimescale == 0L) throw Problem("stts zonder mdhd")
        maxMs = max(maxMs, ms(sttsTotal, mediaTimescale))
      }
      tracks.add(track)
    }

    val video = tracks.filter { it.handler == "vide" }
    val audio = tracks.filter { it.handler == "soun" }
    if (video.size != 1 || video[0].codec !in setOf("avc1", "avc3")) throw Problem("beeld: ${video.map { it.codec }}")
    if (audio.size > 1 || audio.any { it.codec != "mp4a" }) throw Problem("geluid: ${audio.map { it.codec }}")
    if (tracks.size != video.size + audio.size) throw Problem("extra spoor: ${tracks.map { it.handler }}")
    return Info(maxMs)
  }
}
