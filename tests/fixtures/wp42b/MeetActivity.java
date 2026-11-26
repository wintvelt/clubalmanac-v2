package nl.meet;

import android.app.Activity;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.FrameDropEffect;
import androidx.media3.transformer.AudioEncoderSettings;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.InAppMp4Muxer;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;
import com.google.common.collect.ImmutableList;
import java.io.File;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.TimeZone;

// WP42b, A: meetapp (niet de app). Leest wat Android uit een filmpje haalt
// (MediaMetadataRetriever), maakt "Android-originelen" met MediaMuxer (zoals de
// camera: MPEG4Writer met plaats) en verkleint met Media3 Transformer in drie
// varianten. Uitvoer naar logcat (tag MEET) en files/out.
@UnstableApi
public class MeetActivity extends Activity {
  static final String T = "MEET";
  File in;
  File out;
  final ArrayDeque<String[]> jobs = new ArrayDeque<>();

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    in = new File(getFilesDir(), "in");
    out = new File(getFilesDir(), "out");
    out.mkdirs();
    Log.i(T, "tz=" + TimeZone.getDefault().getID() + " now=" + System.currentTimeMillis());
    new Thread(() -> {
      File[] files = in.listFiles();
      if (files != null) for (File f : files) meta("in", f);
      File plain = new File(in, "plain.mp4");
      remux(plain, "android-ams.mp4", 52.3676f, 4.9041f, 0);
      remux(plain, "android-syd.mp4", -33.8688f, 151.2093f, 0);
      remux(plain, "android-nyc.mp4", 40.7128f, -74.0060f, 0);
      remux(plain, "android-kleinnegatief.mp4", -0.5f, -0.25f, 0);
      remux(plain, "android-staand.mp4", 52.3676f, 4.9041f, 90);
      remux(new File(in, "lang-180.mp4"), "android-lang-180.mp4", 52.3676f, 4.9041f, 0);
      for (String n : new String[] {"android-ams.mp4", "android-syd.mp4", "android-nyc.mp4", "android-kleinnegatief.mp4", "android-staand.mp4", "android-lang-180.mp4"}) {
        meta("remux", new File(out, n));
      }
      // input, uitvoer, variant
      jobs.add(new String[] {"out/android-ams.mp4", "t-standaard-android-ams.mp4", "standaard"});
      jobs.add(new String[] {"in/location-loci-date.mp4", "t-standaard-loci.mp4", "standaard"});
      jobs.add(new String[] {"out/android-ams.mp4", "t-inapp-metadata-android-ams.mp4", "inapp-metadata"});
      jobs.add(new String[] {"out/android-ams.mp4", "t-schoon-android-ams.mp4", "schoon"});
      jobs.add(new String[] {"out/android-staand.mp4", "t-schoon-android-staand.mp4", "schoon"});
      jobs.add(new String[] {"in/location-loci-date.mp4", "t-schoon-loci.mp4", "schoon"});
      jobs.add(new String[] {"in/iphone-like.mov", "t-schoon-iphone-like.mp4", "schoon"});
      jobs.add(new String[] {"in/noaudio.mp4", "t-schoon-noaudio.mp4", "schoon"});
      jobs.add(new String[] {"in/lang-180.mp4", "t-schoon-lang-180.mp4", "schoon"});
      jobs.add(new String[] {"in/lang-1803.mp4", "t-schoon-lang-1803.mp4", "schoon"});
      runOnUiThread(this::next);
    }).start();
  }

  void next() {
    String[] job = jobs.poll();
    if (job == null) {
      Log.i(T, "KLAAR");
      return;
    }
    File src = new File(getFilesDir(), job[0]);
    File dst = new File(out, job[1]);
    dst.delete();
    String variant = job[2];
    DefaultEncoderFactory.Builder enc = new DefaultEncoderFactory.Builder(this)
        .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder().setBitrate(3_600_000).build())
        .setEnableFallback(true);
    if (!variant.equals("standaard")) {
      enc.setRequestedAudioEncoderSettings(new AudioEncoderSettings.Builder().setBitrate(128_000).build());
    }
    Transformer.Builder tb = new Transformer.Builder(this)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(enc.build());
    if (variant.equals("schoon")) {
      tb.setMuxerFactory(new InAppMp4Muxer.Factory(entries -> entries.clear()));
    } else if (variant.equals("inapp-metadata")) {
      tb.setMuxerFactory(new InAppMp4Muxer.Factory());
    }
    long t0 = System.currentTimeMillis();
    tb.addListener(new Transformer.Listener() {
      @Override
      public void onCompleted(Composition c, ExportResult r) {
        Log.i(T, "export " + job[1] + " ok ms=" + (System.currentTimeMillis() - t0)
            + " duur=" + r.approximateDurationMs + " bytes=" + r.fileSizeBytes
            + " vbit=" + r.averageVideoBitrate + " abit=" + r.averageAudioBitrate
            + " venc=" + r.videoEncoderName + " aenc=" + r.audioEncoderName
            + " vconv=" + r.videoConversionProcess + " aconv=" + r.audioConversionProcess);
        meta("uit", dst);
        next();
      }

      @Override
      public void onError(Composition c, ExportResult r, ExportException e) {
        Log.e(T, "export " + job[1] + " FOUT " + e.getErrorCodeName() + " " + e.getMessage(), e);
        next();
      }
    });
    EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(src)))
        .setEffects(variant.equals("standaard")
            ? Effects.EMPTY
            : new Effects(ImmutableList.of(), ImmutableList.of(FrameDropEffect.createDefaultFrameDropEffect(30))))
        .build();
    Composition.Builder cb = new Composition.Builder(new EditedMediaItemSequence.Builder(item).build());
    if (!variant.equals("standaard")) cb.setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL);
    tb.build().start(cb.build(), dst.getAbsolutePath());
  }

  void remux(File src, String name, float lat, float lon, int rotation) {
    File dst = new File(out, name);
    dst.delete();
    MediaExtractor ex = new MediaExtractor();
    MediaMuxer mux = null;
    try {
      ex.setDataSource(src.getAbsolutePath());
      mux = new MediaMuxer(dst.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
      int n = ex.getTrackCount();
      int[] map = new int[n];
      for (int i = 0; i < n; i++) {
        MediaFormat f = ex.getTrackFormat(i);
        map[i] = mux.addTrack(f);
        ex.selectTrack(i);
      }
      mux.setLocation(lat, lon);
      if (rotation != 0) mux.setOrientationHint(rotation);
      mux.start();
      ByteBuffer buf = ByteBuffer.allocate(4 << 20);
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      for (;;) {
        int size = ex.readSampleData(buf, 0);
        if (size < 0) break;
        int flags = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
        info.set(0, size, ex.getSampleTime(), flags);
        mux.writeSampleData(map[ex.getSampleTrackIndex()], buf, info);
        ex.advance();
      }
      mux.stop();
      Log.i(T, "remux " + name + " ok");
    } catch (Exception e) {
      Log.e(T, "remux " + name + " FOUT", e);
    } finally {
      ex.release();
      if (mux != null) mux.release();
    }
  }

  void meta(String kind, File f) {
    MediaMetadataRetriever r = new MediaMetadataRetriever();
    try {
      r.setDataSource(f.getAbsolutePath());
      Log.i(T, kind + " " + f.getName()
          + " | date=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE)
          + " | location=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION)
          + " | duration=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
          + " | rotation=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
          + " | wh=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
          + "x" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
          + " | mime=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
          + " | bitrate=" + r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)
          + " | bytes=" + f.length());
    } catch (Exception e) {
      Log.e(T, kind + " " + f.getName() + " meta FOUT " + e);
    } finally {
      try {
        r.release();
      } catch (Exception ignored) {
      }
    }
  }
}
