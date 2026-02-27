import { config } from "dotenv";
import { Blob } from "buffer";

config();

async function debug() {
  const apiUrl = process.env.MATTERBASE_API_URL!;
  const apiKey = process.env.MATTERBASE_API_KEY!;

  console.log("Testing addProductImage directly...\n");

  // 1. Fetch image
  console.log("1. Fetching image from picsum...");
  const imageResponse = await fetch("https://picsum.photos/400/300.jpg");
  console.log("   Status:", imageResponse.status);
  const imageBuffer = await imageResponse.arrayBuffer();
  console.log("   Buffer size:", imageBuffer.byteLength);

  // Create a proper Blob with type
  const imageBlob = new Blob([imageBuffer], { type: "image/jpeg" });
  console.log("   Blob size:", imageBlob.size, "type:", imageBlob.type);

  // 2. Create FormData
  const formData = new FormData();
  formData.append("productId", "1");
  formData.append("productTypeId", "1");
  formData.append("productName", "Parent Product 1");
  formData.append("productImageArr", JSON.stringify([]));
  formData.append("productProjectImageArr", JSON.stringify([]));
  formData.append("productImages", imageBlob, "test-image.jpg");

  console.log("\n2. Sending request to product-images/update...");
  console.log("   URL:", `${apiUrl}/api/v1/admin/product/product-images/update`);

  const response = await fetch(`${apiUrl}/api/v1/admin/product/product-images/update`, {
    method: "PUT",
    headers: {
      "x-api-key": apiKey,
    },
    body: formData,
  });

  console.log("   Status:", response.status);
  console.log("   Content-Type:", response.headers.get("content-type"));

  const text = await response.text();
  console.log("   Response:", text.substring(0, 1000));
}

debug().catch(console.error);
