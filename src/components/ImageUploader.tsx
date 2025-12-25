import { useCallback, useState } from "react";
import { Upload, Camera, Image as ImageIcon, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ImageUploaderProps {
  uploadedImage: string | null;
  onImageUpload: (imageUrl: string) => void;
  onClear: () => void;
}

export function ImageUploader({ uploadedImage, onImageUpload, onClear }: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image size should be less than 10MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onImageUpload(result);
      toast.success("Image uploaded successfully!");
    };
    reader.readAsDataURL(file);
  }, [onImageUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (uploadedImage) {
    return (
      <div className="relative rounded-2xl overflow-hidden bg-card shadow-medium animate-scale-in">
        <img 
          src={uploadedImage} 
          alt="Uploaded room" 
          className="w-full h-auto max-h-[500px] object-contain"
        />
        <Button
          variant="destructive"
          size="icon"
          className="absolute top-4 right-4 rounded-full shadow-medium"
          onClick={onClear}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        "relative rounded-2xl border-2 border-dashed transition-all duration-300 p-12",
        "bg-card hover:bg-muted/50 cursor-pointer",
        isDragging 
          ? "border-anthracite bg-anthracite/5 scale-[1.02]" 
          : "border-border hover:border-anthracite/30"
      )}
    >
      <input
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      
      <div className="flex flex-col items-center text-center">
        <div className={cn(
          "w-16 h-16 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300",
          isDragging ? "bg-anthracite text-primary-foreground" : "bg-muted text-muted-foreground"
        )}>
          <Upload className="w-7 h-7" />
        </div>
        
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Upload your room photo
        </h3>
        <p className="text-muted-foreground text-sm max-w-sm mb-6">
          Drag and drop an image here, or click to browse. For best results, use a well-lit photo showing the wall clearly.
        </p>
        
        <div className="flex items-center gap-3">
          <Button variant="hero" size="lg">
            <ImageIcon className="w-4 h-4 mr-2" />
            Choose Image
          </Button>
          <Button variant="minimal" size="lg">
            <Camera className="w-4 h-4 mr-2" />
            Take Photo
          </Button>
        </div>
      </div>
    </div>
  );
}
