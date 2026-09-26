import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
  } from '@aws-sdk/client-s3'
  import { createReadStream } from 'node:fs'
  import type { Readable } from 'node:stream'
  
  function getR2Config(): {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    bucketName: string
  } {
    const endpoint = process.env.R2_ENDPOINT
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const bucketName = process.env.R2_BUCKET_NAME
  
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error(
        'R2 configuration is missing. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
      )
    }
  
    return {
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucketName,
    }
  }
  
  function getR2Client(): S3Client {
    const { endpoint, accessKeyId, secretAccessKey } = getR2Config()
  
    return new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }
  
  export async function uploadPdf(
    filePath: string,
    objectKey: string,
  ): Promise<void> {
    const { bucketName } = getR2Config()
    const r2Client = getR2Client()
    const body = createReadStream(filePath)
  
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: body,
        ContentType: 'application/pdf',
      }),
    )
  }
  
  export async function deletePdf(objectKey: string): Promise<void> {
    const { bucketName } = getR2Config()
    const r2Client = getR2Client()
  
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }),
    )
  }
  
  export async function getPdf(
    objectKey: string,
  ): Promise<{
    body: Readable
    contentLength?: number
  }> {
    const { bucketName } = getR2Config()
    const r2Client = getR2Client()
  
    const result = await r2Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }),
    )
  
    if (!result.Body) {
      throw new Error('R2 returned an empty PDF body.')
    }
  
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength,
    }
  }